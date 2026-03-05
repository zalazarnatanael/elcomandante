const { z } = require('zod');

const createBody = z.object({
  project_id: z.string().min(1),
  notion_workspace_id: z.string().min(1),
  database_id: z.string().min(1).optional(),
  is_primary: z.boolean().optional()
}).strict();

const params = z.object({
  id: z.string().min(1)
});

module.exports = {
  createProjectWorkspaceSchema: z.object({ body: createBody }),
  deleteProjectWorkspaceSchema: z.object({ params })
};
