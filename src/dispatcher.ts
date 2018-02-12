import { TestModule, TestResult } from "./test";
import * as cp from 'child_process';
import { ChildProcess } from 'child_process';

export class NotFound extends Error {
}

interface Run {
  process: cp.ChildProcess;
  suite: string;
  started: Date;
  finished?: Date;
  result?: TestResult;
  error?: Error;
}

class LocalRun {
  private readonly started: Date;
  private finished?: Date;
  private result?: TestResult;
  private error?: Error;

  constructor(private readonly suite: string, private readonly process: ChildProcess) {
    this.started = new Date();
  }

  complete(result: TestResult) {
    this.result = result;
    this.finish();
  }

  fail(error: Error) {
    this.error = error;
    this.finish();
  }

  cancel() {
    this.process.kill();
  }

  toStatus(): string {
    if (!this.finished) {
      return 'active';
    }
    if (this.result) {
      return 'completed';
    }
    if (this.process.killed) {
      return 'cancelled';
    }
    return 'error';
  }

  toSuiteName() {
    return this.suite;
  }

  toRuntime() {
    if (this.finished) {
      return this.finished.getTime() - this.started.getTime();
    }
    return new Date().getTime() - this.started.getTime();
  }

  private finish() {
    this.finished = new Date();
  }
}

export class Dispatcher {
  private readonly runList = new Map<string, Run>();

  private nextId = 1;

  constructor(private readonly module: TestModule) {
  }

  start(suite: string): string {
    if (this.module.has(suite)) {
      const id = this.generateId();
      const cmd = this.module.makeRunCommand(suite);
      const process = cp.execFile(cmd.command, cmd.args, (error, stdout, stderr) => {
        const run = this.runList.get(id)!;
        run.finished = new Date();
        if (error) {
          run.error = error;
          return;
        }
        if (!stdout && stderr) {
          run.error = new Error(stderr);
          return;
        }
        try {
          run.result = this.module.decodeResult(stdout);
        } catch (e) {
          run.error = e;
          return;
        }
      });
      this.runList.set(id, {
        process: process,
        suite: suite,
        started: new Date()
      });
      return id;
    }
    throw new NotFound(suite);
  }

  getStatus(id: string): { suite: string, status: string, runtime: number, error?: Error, result?: TestResult } {
    const run = this.runList.get(id);
    if (run === undefined) {
      throw new NotFound(id);
    }
    if (run.error) {
      return {
        suite: run.suite,
        status: run.process.killed ? 'cancelled' : 'error',
        runtime: run.finished!.getTime() - run.started.getTime(),
        error: run.error
      }
    }
    if (run.result) {
      return {
        suite: run.suite,
        status: 'completed',
        runtime: run.finished!.getTime() - run.started.getTime(),
        result: run.result
      }
    }
    return {
      suite: run.suite,
      status: 'active',
      runtime: (new Date()).getTime() - run.started.getTime()
    }
  }

  cancel(id: string) {
    const run = this.runList.get(id);
    if (!run) {
      throw new NotFound(id);
    }
    run.process.kill();
  }

  private generateId(): string {
    return (this.nextId++).toString();
  }
}