const { createProjectSchema } = require('../../src/features/projects/project.schema');

describe('project schema', () => {
  it('accepts valid project payload', () => {
    const input = {
      body: {
        name: 'Project A',
        github_owner: 'owner',
        github_repo: 'repo'
      }
    };
    expect(() => createProjectSchema.parse(input)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    const input = { body: { name: 'Project A' } };
    expect(() => createProjectSchema.parse(input)).toThrow();
  });
});
