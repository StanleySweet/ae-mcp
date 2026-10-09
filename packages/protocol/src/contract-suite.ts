import { errorHints } from './errors.js';
import { PROTOCOL_VERSION, type JobMessage, type ResultMessage } from './messages.js';

export interface BridgeDriver {
  sendJob(job: JobMessage): Promise<void>;
  sendRaw(name: string, content: string): Promise<void>;
  waitForResult(id: string): Promise<ResultMessage>;
}

export interface ContractCase {
  name: string;
  run(driver: BridgeDriver): Promise<void>;
}

function okJob(id: string, tool: string, args: unknown): JobMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    tool,
    args,
    deadline: Date.now() + 5000,
  };
}

export function contractCases(okTool = 'fake.echo'): ContractCase[] {
  const expectFailure = async (driver: BridgeDriver, id: string) => {
    const result = await driver.waitForResult(id);
    if (result.ok) {
      throw new Error(`expected a failure result for ${id}, got ok`);
    }
    return result;
  };

  return [
    {
      name: 'returns an ok result correlated by id',
      run: async (driver) => {
        await driver.sendJob(okJob('c-ok', okTool, { ping: true }));
        const result = await driver.waitForResult('c-ok');
        if (result.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error('ok result dropped protocolVersion');
        }
        if (!result.ok) {
          throw new Error(`expected ok result, got ${JSON.stringify(result.error)}`);
        }
      },
    },
    {
      name: 'rejects a malformed message with INVALID_MESSAGE and the canonical hint',
      run: async (driver) => {
        await driver.sendRaw('c-bad.json', 'this is not JSON');
        const result = await expectFailure(driver, 'c-bad');
        if (result.error.code !== 'INVALID_MESSAGE') {
          throw new Error(`expected INVALID_MESSAGE, got ${result.error.code}`);
        }
        if (result.error.hint !== errorHints.INVALID_MESSAGE) {
          throw new Error(`expected the canonical INVALID_MESSAGE hint`);
        }
      },
    },
    {
      name: 'rejects an unknown tool with UNKNOWN_TOOL',
      run: async (driver) => {
        await driver.sendJob(okJob('c-unknown', 'does.not.exist', {}));
        const result = await expectFailure(driver, 'c-unknown');
        if (result.error.code !== 'UNKNOWN_TOOL') {
          throw new Error(`expected UNKNOWN_TOOL, got ${result.error.code}`);
        }
      },
    },
    {
      name: 'rejects an expired deadline with TIMEOUT',
      run: async (driver) => {
        const deadline = Date.now() - 1;
        await driver.sendJob({ ...okJob('c-late', okTool, {}), deadline });
        const result = await expectFailure(driver, 'c-late');
        if (result.error.code !== 'TIMEOUT') {
          throw new Error(`expected TIMEOUT, got ${result.error.code}`);
        }
      },
    },
  ];
}