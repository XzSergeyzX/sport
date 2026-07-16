import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { cyclePhase, daysBetween } from '@/lib/db/cycle';
import {
  leaderboardRpcFilters,
} from '@/lib/db/leaderboard';
import {
  discardConflictingWorkout,
  enqueueSetDraftMutations,
  type FinishVars,
  registerWorkoutMutationDefaults,
  workoutMutationScope,
  WORKOUT_FINISH,
} from '@/lib/db/workout-mutations';
import {
  ActiveWorkoutExistsError,
  findActiveWorkoutSummary,
  isActiveWorkoutExistsError,
  workoutStats,
  type WorkoutDetail,
  type WorkoutSummary,
} from '@/lib/db/workouts';
import { hasPrivateAccess } from '@/lib/use-role';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { flushPendingCallbacks } from '@/lib/use-debounced-callback';
import { fromKg, toKg } from '@/lib/use-unit';

const summary = (id: string, endedAt: string | null): WorkoutSummary => ({
  id,
  user_id: 'user-1',
  started_at: `2026-07-16T10:0${id}:00.000Z`,
  ended_at: endedAt,
  title: null,
  notes: null,
  exercise_count: 0,
  set_count: 0,
  rep_count: 0,
  hold_sec: 0,
  tonnage: 0,
});

describe('product role policy', () => {
  test.each([
    [undefined, false],
    ['grip', false],
    ['full', true],
    ['admin', true],
  ] as const)('%s private access = %s', (role, expected) => {
    expect(hasPrivateAccess(role)).toBe(expected);
  });
});

describe('leaderboard category boundaries', () => {
  test('XF-300 handle codes are sent as independent server-side filters', () => {
    expect(leaderboardRpcFilters('dynamometer', 'xf300_14mm', 'tns')).toEqual({
      p_board: 'dynamometer',
      p_dynamometer_code: 'xf300_14mm',
      p_set_type: null,
    });
    expect(leaderboardRpcFilters('dynamometer', 'xf300_18mm', 'deep')).toEqual({
      p_board: 'dynamometer',
      p_dynamometer_code: 'xf300_18mm',
      p_set_type: null,
    });
    expect(leaderboardRpcFilters('gripper', 'xf300_14mm', 'card')).toEqual({
      p_board: 'gripper',
      p_dynamometer_code: null,
      p_set_type: 'card',
    });
    expect(() => leaderboardRpcFilters('dynamometer', null, 'tns')).toThrow(
      'dynamometer_category_required',
    );
  });
});

describe('active workout invariant', () => {
  test('returns the newest active workout and does not mistake completed workouts for active', () => {
    const workouts = [
      summary('1', '2026-07-16T11:00:00.000Z'),
      summary('2', null),
      summary('3', null),
    ];

    expect(findActiveWorkoutSummary(workouts)?.id).toBe('2');
    expect(findActiveWorkoutSummary([workouts[0]])).toBeUndefined();
    expect(findActiveWorkoutSummary(undefined)).toBeUndefined();
  });

  test('classifies an active-workout conflict without swallowing generic errors', () => {
    const error = new ActiveWorkoutExistsError('existing-workout');
    expect(isActiveWorkoutExistsError(error)).toBe(true);
    expect(error.activeWorkoutId).toBe('existing-workout');
    expect(isActiveWorkoutExistsError(new Error('network'))).toBe(false);
  });

  test('offline finish immediately clears active state in the summary cache', async () => {
    const qc = new QueryClient();
    const active = summary('2', null);
    const detail: WorkoutDetail = {
      id: active.id,
      user_id: active.user_id,
      started_at: active.started_at,
      ended_at: null,
      title: null,
      notes: null,
      workout_exercises: [],
    };
    qc.setQueryData(['workout', active.id], detail);
    qc.setQueryData(['workouts', active.user_id], [active]);
    registerWorkoutMutationDefaults(qc);

    const onMutate = qc.getMutationDefaults(WORKOUT_FINISH).onMutate as (
      vars: FinishVars,
    ) => Promise<unknown>;
    await onMutate({ workoutId: active.id, endedAt: '2026-07-16T11:00:00.000Z' });

    expect(findActiveWorkoutSummary(qc.getQueryData(['workouts', active.user_id]))).toBeUndefined();
    expect(qc.getQueryData<WorkoutDetail>(['workout', active.id])?.ended_at).toBe(
      '2026-07-16T11:00:00.000Z',
    );
    qc.clear();
  });

  test('discarding a unique conflict removes only the optimistic phantom', () => {
    const qc = new QueryClient();
    const existing = summary('1', null);
    const phantom = summary('2', null);
    const phantomDetail: WorkoutDetail = {
      id: phantom.id,
      user_id: phantom.user_id,
      started_at: phantom.started_at,
      ended_at: null,
      title: null,
      notes: null,
      workout_exercises: [],
    };
    qc.setQueryData(['workout', phantom.id], phantomDetail);
    qc.setQueryData(['workouts', phantom.user_id], [phantom, existing]);

    discardConflictingWorkout(qc, phantomDetail);

    expect(qc.getQueryData(['workout', phantom.id])).toBeUndefined();
    expect(qc.getQueryData<WorkoutSummary[]>(['workouts', phantom.user_id])?.map((w) => w.id)).toEqual([
      existing.id,
    ]);
    qc.clear();
  });
});

describe('offline mutation ordering', () => {
  test('all durable operations in one workout receive the same stable scope', () => {
    expect(workoutMutationScope('workout-1')).toEqual({ id: 'workout-workout-1-sets' });
    expect(workoutMutationScope('workout-1')).toEqual(workoutMutationScope('workout-1'));
    expect(workoutMutationScope('workout-1')).not.toEqual(workoutMutationScope('workout-2'));
  });
});

describe('debounced durable updates', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('coalesces rapid changes and keeps only the latest value', async () => {
    const callback = jest.fn();
    const { result } = await renderHook(() => useDebouncedCallback(callback, 400));

    await act(() => {
      result.current.schedule('1');
      result.current.schedule('12');
      result.current.schedule('123');
      jest.advanceTimersByTime(399);
    });
    expect(callback).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(1));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('123');
  });

  test('flushes immediately and flushes pending input on unmount', async () => {
    const callback = jest.fn();
    const { result, unmount } = await renderHook(() => useDebouncedCallback(callback, 400));

    await act(() => {
      result.current.schedule('blur');
      result.current.flush();
    });
    expect(callback).toHaveBeenLastCalledWith('blur');

    await act(() => result.current.schedule('unmount'));
    await unmount();
    expect(callback).toHaveBeenLastCalledWith('unmount');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test('queues UPDATE before auto-LOG and background flush drains every pending set', () => {
    const order: string[] = [];
    enqueueSetDraftMutations(
      () => order.push('update'),
      () => order.push('log'),
      { workoutId: 'workout-1', id: 'set-1', input: { reps: 12 } },
      true,
    );
    const pending = new Set([() => order.push('flush-1'), () => order.push('flush-2')]);
    flushPendingCallbacks(pending);

    expect(order).toEqual(['update', 'log', 'flush-1', 'flush-2']);
  });
});

describe('workout metrics', () => {
  test('counts only logged sets and doubles both-side volume', () => {
    const workout: WorkoutDetail = {
      id: 'workout-1',
      user_id: 'user-1',
      started_at: '2026-07-16T10:00:00.000Z',
      ended_at: '2026-07-16T10:45:00.000Z',
      title: null,
      notes: null,
      workout_exercises: [
        {
          id: 'we-1',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          order_index: 0,
          done_at: null,
          block_key: null,
          block_label: null,
          block_rounds: null,
          block_type: null,
          block_interval_sec: null,
          display_name: null,
          exercise: null,
          sets: [
            {
              id: 'set-1',
              workout_exercise_id: 'we-1',
              reps: 5,
              duration_sec: null,
              weight: 20,
              rest_sec: null,
              rpe: null,
              note: null,
              meta: { side: 'both' },
              completed_at: '2026-07-16T10:10:00.000Z',
              logged_at: '2026-07-16T10:10:00.000Z',
            },
            {
              id: 'set-2',
              workout_exercise_id: 'we-1',
              reps: 99,
              duration_sec: null,
              weight: 99,
              rest_sec: null,
              rpe: null,
              note: null,
              meta: null,
              completed_at: '2026-07-16T10:11:00.000Z',
              logged_at: null,
            },
          ],
        },
      ],
    };

    expect(workoutStats(workout)).toEqual({
      tonnage: 200,
      sets: 1,
      reps: 10,
      holdSec: 0,
      exercises: 1,
      durationMin: 45,
    });
  });
});

describe('cycle and unit boundaries', () => {
  test.each([
    [1, 'menstrual'],
    [5, 'menstrual'],
    [6, 'follicular'],
    [13, 'follicular'],
    [14, 'ovulation'],
    [16, 'ovulation'],
    [17, 'luteal'],
  ] as const)('cycle day %s is %s', (day, phase) => {
    expect(cyclePhase(day)).toBe(phase);
  });

  test('calendar difference and kg/lb conversion are reversible', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    const pounds = fromKg(40, 'lb');
    expect(pounds).not.toBeNull();
    expect(toKg(pounds, 'lb')).toBeCloseTo(40, 8);
  });
});
