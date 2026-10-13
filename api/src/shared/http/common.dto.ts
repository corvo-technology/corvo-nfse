import { IsBoolean, IsHexColor, IsOptional } from 'class-validator';

export class BooleanFlagDto {
  @IsBoolean()
  isActive!: boolean;
}

export class HexColorDto {
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;
}

export function fileUploadLimits() {
  return {
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  };
}
