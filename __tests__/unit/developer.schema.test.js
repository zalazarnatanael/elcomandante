const { upsertDeveloperSchema } = require('../../src/features/developers/developer.schema');

describe('developer schema', () => {
  it('accepts valid developer payload', () => {
    const input = {
      body: {
        github_username: 'dev1',
        token: 'ghp_token'
      }
    };
    expect(() => upsertDeveloperSchema.parse(input)).not.toThrow();
  });

  it('rejects missing github_username', () => {
    const input = { body: { token: 'ghp_token' } };
    expect(() => upsertDeveloperSchema.parse(input)).toThrow();
  });
});
