import { sleep } from 'lib/commons/utils';
import { Poll } from './polling';

describe(`Callback is polled correctly by default`, () => {
  it('Polls the callback 1 time in 1 second', async () => {
    const mockCallback = jest.fn();
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    });
    poll.start();
    setTimeout(endCallback, 1020);
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(1);
  });

  it('Polls the callback 2 times in 2 seconds', async () => {
    const mockCallback = jest.fn();
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    });
    poll.start();
    setTimeout(endCallback, 2020);
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(2);
  });
});

describe('Allows to specify the polling interval and timeout', () => {
  it('Polls the callback 3 times in 0.3s for 0.1s polling interval', async () => {
    const mockCallback = jest.fn();
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    }, 100);
    poll.start();
    setTimeout(endCallback, 310);
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(3);
  });

  it('Polls the callback 1 time in 0.15s for 0.1s polling interval', async () => {
    const mockCallback = jest.fn();
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    }, 100);
    poll.start();
    setTimeout(endCallback, 150);
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(1);
  });

  it('Polls the callback 2 times in 0.2s for 0.1s polling interval', async () => {
    const mockCallback = jest.fn();
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    }, 100);
    poll.start();
    setTimeout(endCallback, 210);
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(2);
  });

  it('Polls the callback 3 times for 0.1s polling interval and 0.3s timeout', async () => {
    const mockCallback = jest.fn();
    const poll = new Poll(
      () => {
        return mockCallback;
      },
      100,
      300
    );
    poll.start();
    await poll.wait();
    expect(mockCallback).toBeCalledTimes(3);
  });
});

describe('The `wait` method resolves to a correct value', () => {
  it('resolves to `null` if timed out', async () => {
    const mockCallback = jest.fn<unknown, unknown[]>();
    const poll = new Poll(
      () => {
        return mockCallback;
      },
      100,
      300
    );
    poll.start();
    const result = await poll.wait();
    expect(result).toBe<null>(null);
  });

  it('resolves to `null` if force stopped', async () => {
    const mockCallback = jest.fn<unknown, unknown[]>();
    const poll = new Poll(() => {
      return mockCallback;
    }, 100);
    poll.start();
    setTimeout(poll.cancel, 50);
    const result = await poll.wait();
    expect(result).toBe<null>(null);
  });

  it('resolves to a value if `end(value)` was called', async () => {
    const mockCallback = jest.fn();
    const mockReturnValue = 42;
    let endCallback: (...args: any[]) => void;
    const poll = new Poll((end) => {
      endCallback = end;
      return mockCallback;
    }, 100);
    poll.start();
    setTimeout(() => endCallback(mockReturnValue), 150);
    const result = await poll.wait();
    expect(result).toBe(mockReturnValue);
  });

  it('`wait` resolves to the last polled value if the poll already stopped', async () => {
    const mockCallback = jest.fn<unknown, unknown[]>();
    const mockReturnValue = 'return';
    const pollToCancel = new Poll(() => {
      return mockCallback;
    }, 100);
    const pollToTimeout = new Poll(
      () => {
        return mockCallback;
      },
      100,
      10
    );
    const pollToResolve = new Poll((end) => {
      return () => {
        mockCallback();
        if (true) end(mockReturnValue);
      };
    }, 10);
    pollToCancel.start();
    pollToTimeout.start();
    pollToResolve.start();
    setTimeout(pollToCancel.cancel, 10);
    await sleep(50);
    const cancelResult = await pollToCancel.wait();
    const timeoutResult = await pollToTimeout.wait();
    const resolvedResult = await pollToResolve.wait();
    expect(cancelResult).toBe<null>(null);
    expect(timeoutResult).toBe<null>(null);
    expect(resolvedResult).toBe(mockReturnValue);
  });
});
