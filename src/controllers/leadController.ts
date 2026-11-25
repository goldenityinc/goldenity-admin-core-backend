import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { LeadService } from '../services/leadService';
import {
  createLeadSchema,
  importLeadsSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from '../validations/leadValidation';

function firstIssue(error: { issues: Array<{ message: string; path: Array<string | number> }> }): string {
  const issue = error.issues[0];
  if (!issue) return 'Data lead tidak valid';
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

export const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listLeadsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(firstIssue(parsed.error), 400);

  const result = await LeadService.listLeads(parsed.data);
  res.status(200).json({ success: true, data: result.items, meta: result.meta });
});

export const getLeadSummary = asyncHandler(async (_req: Request, res: Response) => {
  const summary = await LeadService.getLeadSummary();
  res.status(200).json({ success: true, data: summary });
});

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(firstIssue(parsed.error), 400);

  const lead = await LeadService.createLead(parsed.data);
  res.status(201).json({ success: true, data: lead });
});

export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(firstIssue(parsed.error), 400);

  const lead = await LeadService.updateLead(String(req.params.leadId), parsed.data);
  res.status(200).json({ success: true, data: lead });
});

export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  await LeadService.deleteLead(String(req.params.leadId));
  res.status(200).json({ success: true });
});

export const importLeads = asyncHandler(async (req: Request, res: Response) => {
  const parsed = importLeadsSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(firstIssue(parsed.error), 400);

  const result = await LeadService.importLeads(parsed.data.leads);
  res.status(200).json({ success: true, data: result });
});
