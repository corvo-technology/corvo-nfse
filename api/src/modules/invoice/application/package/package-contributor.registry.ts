import { Injectable } from '@nestjs/common';
import type { PackageContributor } from '../../domain/package-contributor';

/** The contributors to the month package, in the order they registered (the NF-e module is one). */
@Injectable()
export class PackageContributorRegistry {
  private readonly contributors: PackageContributor[] = [];

  register(contributor: PackageContributor): void {
    if (!this.contributors.includes(contributor))
      this.contributors.push(contributor);
  }

  all(): readonly PackageContributor[] {
    return this.contributors;
  }
}
