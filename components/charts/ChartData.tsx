/**
 * The values behind a chart, for anyone not reading it off the plot.
 *
 * A chart's hit targets are pointer affordances: one per data point, a few pixels wide on a
 * phone and impossible to land on with a thumb, and as tab stops they would put a hundred of
 * them between a keyboard user and the next control. They are out of the tab order, and the
 * numbers live here instead, in a table that can be opened on any device rather than only
 * reached by a screen reader.
 *
 * Collapsed by default: the plot is the point, and this is the way through when the plot
 * cannot answer the question.
 */

interface ChartDataProps {
  /** Names the table, since a caption is what a screen reader announces on entry. */
  caption: string;
  /** Column headings, the first of which labels the category axis. */
  columns: string[];
  /** One array of already-formatted cells per row, matching `columns`. */
  rows: string[][];
}

export function ChartData({ caption, columns, rows }: ChartDataProps) {
  if (!rows.length) return null;

  // The wrapper carries the visually-hidden treatment rather than the table. Those rules pin
  // the box to 1px and clip the overflow, and a table box ignores the clip: it grows to fit
  // its columns, and because the box is absolutely positioned it then extends the page's
  // scrollable area and the whole document scrolls sideways. A block container clips properly.
  return (
    <details className="mt-2 group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors">
        <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
        {rows.length} values
      </summary>
      {/* The table is the widest thing in a chart card and its column count follows the
          series, so it gets its own scroll container rather than widening the card. */}
      <div className="mt-1 max-h-56 overflow-auto rounded-md border border-gray-200/70 dark:border-gray-700/70">
        <table aria-label={caption} className="w-full text-left text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/80">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1 font-semibold text-gray-500 dark:text-gray-400"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((cells) => (
              <tr key={cells[0]}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-2 py-1 font-medium text-gray-600 dark:text-gray-300"
                >
                  {cells[0]}
                </th>
                {cells.slice(1).map((cell, index) => (
                  <td
                    key={columns[index + 1] ?? index}
                    className="whitespace-nowrap px-2 py-1 text-gray-500 dark:text-gray-400"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
