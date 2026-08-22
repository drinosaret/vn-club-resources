/**
 * Position of a row within its list.
 *
 * The number reflects the order currently on screen, not a stored rank, so it follows the
 * sort control rather than contradicting it.
 *
 * Right-aligned in a fixed width so names line up regardless of how many digits the rank
 * takes. The width holds four, since these lists expand to a thousand or more rows.
 *
 * Left readable to assistive technology rather than hidden: the surrounding rows are plain
 * elements rather than an ordered list, so this number is the only thing conveying position.
 */
export function RankNumber({ rank }: { rank: number }) {
  return (
    <span className="shrink-0 w-8 text-right text-xs font-medium tabular-nums text-gray-500 dark:text-gray-400">
      {rank}
    </span>
  );
}
