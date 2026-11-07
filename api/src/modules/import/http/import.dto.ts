import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class StartImportDto {
  @ApiPropertyOptional({
    description:
      'Company that issues every row that has no CNPJ column value. A row whose CNPJ differs from it is rejected.',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export type UploadedImportFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
};
