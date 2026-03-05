const { z } = require('zod');

const listQuery = z.object({
  status: z.string().optional(),
  project_id: z.string().optional(),
  github_issue_number: z.coerce.number().int().positive().optional()
}).strict();

const params = z.object({
  id: z.string().min(1)
});

module.exports = {
  listTasksSchema: z.object({ query: listQuery }),
  getTaskSchema: z.object({ params }),
  retryTaskSchema: z.object({ params })
};
