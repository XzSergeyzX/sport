import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useAuth } from '@/lib/auth/auth-context';
import { enqueueWorkoutStart } from '@/lib/db/workout-mutations';
import {
  buildEmptyWorkout,
  findActiveWorkoutSummary,
  summarizeWorkout,
  type WorkoutSummary,
} from '@/lib/db/workouts';

/**
 * Старт пустой тренировки «з нуля» (Головна и Тренування зовут одно и то же).
 * Оптимистика кладётся синхронно ЗДЕСЬ, а не в onMutate дефолтов WORKOUT_START:
 * восстановленная из персиста оффлайн-мутация не переигрывает onMutate, поэтому
 * экран — единственное место, где сеются кэши ['workout',id] и ['workouts',userId].
 * Меняешь форму сида — меняй только тут, обе вкладки подхватят.
 */
export function useStartEmptyWorkout(): () => void {
  const qc = useQueryClient();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  return () => {
    if (!userId) return;
    const active = findActiveWorkoutSummary(
      qc.getQueryData<WorkoutSummary[]>(['workouts', userId]),
    );
    if (active) {
      router.push({ pathname: '/workout/[id]', params: { id: active.id } });
      return;
    }
    const workout = buildEmptyWorkout(userId);
    qc.setQueryData(['workout', workout.id], workout);
    qc.setQueryData<WorkoutSummary[]>(['workouts', userId], (old) =>
      old ? [summarizeWorkout(workout), ...old] : [summarizeWorkout(workout)],
    );
    enqueueWorkoutStart(qc, workout, (activeWorkoutId) =>
      router.replace({ pathname: '/workout/[id]', params: { id: activeWorkoutId } }),
    );
    router.push({ pathname: '/workout/[id]', params: { id: workout.id } });
  };
}
