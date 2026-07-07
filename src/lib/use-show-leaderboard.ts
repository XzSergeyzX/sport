import { useQuery } from '@tanstack/react-query';

import { getShowLeaderboard } from '@/lib/db/profile';

export const showLeaderboardKey = (userId: string | undefined) => ['show-leaderboard', userId];

/** Общий запрос тумблера «показувати Лідерборд»: единый конфиг (ключ + staleTime)
 *  для таб-гейта в (tabs)/_layout и свитча в Акаунте — копии не разъезжаются. */
export function useShowLeaderboard(userId: string | undefined) {
  return useQuery({
    queryKey: showLeaderboardKey(userId),
    queryFn: () => getShowLeaderboard(userId as string),
    enabled: !!userId,
    staleTime: 1000 * 60 * 30,
  });
}
