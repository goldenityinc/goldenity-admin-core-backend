// Placeholder for types
export interface RequestWithUser extends Request {
  user?: {
    uid: string;
    email?: string;
    tenantId: string;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
