export type MetaCapiUtm = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
};

export type CompleteRegistrationJobData = {
  kind: 'CompleteRegistration';
  eventId: string;
  authUserId: string;
  email: string;
  /** Unix seconds; the user's account creation time, not the request time. */
  eventTime: number;
  eventSourceUrl?: string;
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  utm?: MetaCapiUtm;
};
