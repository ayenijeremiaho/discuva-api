import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter wording', () => {
  const rules = [
    { from: 'Departments', to: 'Teams' },
    { from: 'Department', to: 'Team' },
  ];
  const run = async (exception: unknown) => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/v1/x', method: 'GET' }),
      }),
    };
    await new HttpExceptionFilter(() => Promise.resolve(rules)).catch(
      exception,
      host as never,
    );
    return json.mock.calls[0][0].message as string;
  };

  it("puts the account's words into an error", async () => {
    expect(await run(new BadRequestException('Department not found'))).toBe(
      'Team not found',
    );
  });

  it('never rewords the URL of an unknown route', async () => {
    expect(
      await run(new NotFoundException('Cannot GET /v1/departments/1/services')),
    ).toBe('Cannot GET /v1/departments/1/services');
  });
});
