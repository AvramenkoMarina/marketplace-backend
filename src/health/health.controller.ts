import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly db: DatabaseService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('db/ping')
  async dbPing() {
    const result = await this.db.query<{ ok: number }>('SELECT 1 AS ok');
    return { ok: result.rows[0]?.ok === 1, via: 'postgres' };
  }
}
