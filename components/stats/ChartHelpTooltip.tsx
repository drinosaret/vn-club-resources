import { HelpCircle } from 'lucide-react';

interface ChartHelpTooltipProps {
  text: string;
}

export function ChartHelpTooltip({ text }: ChartHelpTooltipProps) {
  return (
    <span className="relative inline-flex ml-1 group/help">
      <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 w-64 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-xs leading-relaxed px-3 py-2 opacity-0 group-hover/help:opacity-100 transition-opacity z-50 shadow-lg">
        {text}
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900 dark:border-b-gray-700" />
      </span>
    </span>
  );
}
