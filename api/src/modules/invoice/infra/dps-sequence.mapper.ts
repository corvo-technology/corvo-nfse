import { DpsSequenceProps } from '../domain/dps-sequence';
import { DpsSequenceOrmEntity } from './dps-sequence.orm-entity';

export class DpsSequenceMapper {
  toDomain(orm: DpsSequenceOrmEntity): DpsSequenceProps {
    return {
      companyId: orm.companyId,
      series: orm.series,
      currentNumber: Number(orm.currentNumber),
      updatedAt: orm.updatedAt,
    };
  }

  toPersistence(props: DpsSequenceProps): DpsSequenceOrmEntity {
    const orm = new DpsSequenceOrmEntity();
    orm.companyId = props.companyId;
    orm.series = props.series;
    orm.currentNumber = props.currentNumber;
    orm.updatedAt = props.updatedAt;
    return orm;
  }
}
