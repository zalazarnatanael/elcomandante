const { z } = require('zod');

const workspaceBody = z.object({
  workspace_id: z.string().min(1),
  workspace_name: z.string().min(1),
  api_key: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional()
}).strict();

const workspaceParams = z.object({
  id: z.string().min(1)
});

module.exports = {
  createWorkspaceSchema: z.object({ body: workspaceBody }),
  updateWorkspaceSchema: z.object({ body: workspaceBody.partial(), params: workspaceParams }),
  getWorkspaceSchema: z.object({ params: workspaceParams })
};
