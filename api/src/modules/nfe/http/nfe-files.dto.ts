import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class NfeDownloadUrlDto {
  @ApiProperty({
    enum: ['xml', 'pdf'],
    description: '`xml` is the `nfeProc`; `pdf` is the DANFE.',
  })
  @IsIn(['pdf', 'xml'])
  format!: 'xml' | 'pdf';
}
