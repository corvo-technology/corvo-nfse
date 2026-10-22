import { Injectable } from '@nestjs/common';

export type HealthResponse = {
  status: 'ok';
  timestamp: string;
  uptime: number;
};

@Injectable()
export class HealthService {
  getLive(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

}
