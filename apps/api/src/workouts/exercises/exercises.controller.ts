import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExerciseDto, ExerciseQueryDto } from '../dto/workout-program.dtos';
import { ExerciseResolverService } from './exercise-resolver.service';

/** The movement catalog, plus whatever this user's programs invented. */
@ApiTags('Workouts')
@Controller('workouts/exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExerciseResolverService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Browse the exercise catalog',
    description:
      'The shared catalog plus the caller\'s own custom rows — never another user\'s. Filter by ' +
      'a name fragment (`q`) or a substitution group (`group`).',
  })
  @ApiResponse({ status: 200, type: [ExerciseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ExerciseQueryDto,
  ): Promise<{ items: ExerciseDto[] }> {
    const rows = await this.exercises.list(userId, query);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        equipment: row.equipment,
        movementPattern: row.movementPattern,
        instructions: row.instructions,
        contraindicationTags: row.contraindicationTags,
        substitutionGroup: row.substitutionGroup,
        isCustom: row.isCustom,
      })),
    };
  }
}
