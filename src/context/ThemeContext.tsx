import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type RetailPulseThemeId =
  | 'google-cloud'
  | 'google-gemini'
  | 'google-sage'
  | 'google-dark';

export interface ThemePaletteConfig {
  id: RetailPulseThemeId;
  label: string;
  shortLabel: string;
  description: string;
  isDark: boolean;
  swatches: [string, string, string, string];
  primaryHex: string;
  secondaryHex: string;
  chartPalette: string[];
  kpiAccents: [string, string, string, string, string];
  gridColor: string;
  axisColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  donutStroke: string;
}

export const RETAILPULSE_THEMES: Record<RetailPulseThemeId, ThemePaletteConfig> = {
  'google-cloud': {
    id: 'google-cloud',
    label: 'Google Cloud',
    shortLabel: 'Cloud',
    description: 'Crisp Google Workspace daylight with iconic 4-color accents',
    isDark: false,
    swatches: ['#4285F4', '#EA4335', '#FBBC04', '#34A853'],
    primaryHex: '#1A73E8',
    secondaryHex: '#34A853',
    chartPalette: [
      '#4285F4', // Google Blue
      '#34A853', // Google Green
      '#FBBC04', // Google Yellow
      '#EA4335', // Google Red
      '#9334E6', // Google Purple
      '#00ACC1', // Google Cyan
      '#F97316', // Warm Coral
      '#137333'  // Deep Forest
    ],
    kpiAccents: ['#1A73E8', '#1E8E3E', '#F9AB00', '#D93025', '#9334E6'],
    gridColor: 'rgba(15, 23, 42, 0.08)',
    axisColor: '#475569',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#CBD5E1',
    tooltipText: '#0F172A',
    donutStroke: '#FFFFFF'
  },
  'google-gemini': {
    id: 'google-gemini',
    label: 'Gemini Prism',
    shortLabel: 'Gemini',
    description: 'Luminous cobalt, violet, and teal studio palette',
    isDark: false,
    swatches: ['#2563EB', '#7C3AED', '#0D9488', '#EC4899'],
    primaryHex: '#4F46E5',
    secondaryHex: '#0D9488',
    chartPalette: [
      '#4F46E5', // Indigo
      '#0D9488', // Teal
      '#7C3AED', // Violet
      '#EC4899', // Magenta
      '#2563EB', // Cobalt
      '#F59E0B', // Amber
      '#06B6D4', // Cyan
      '#E11D48'  // Rose
    ],
    kpiAccents: ['#4F46E5', '#0D9488', '#7C3AED', '#DB2777', '#2563EB'],
    gridColor: 'rgba(30, 41, 59, 0.08)',
    axisColor: '#475569',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#C7D2FE',
    tooltipText: '#0F172A',
    donutStroke: '#FFFFFF'
  },
  'google-sage': {
    id: 'google-sage',
    label: 'Google Earth',
    shortLabel: 'Earth',
    description: 'Fresh botanical emerald, ocean teal, and sunlit amber',
    isDark: false,
    swatches: ['#137333', '#007B83', '#E37400', '#1967D2'],
    primaryHex: '#137333',
    secondaryHex: '#007B83',
    chartPalette: [
      '#137333', // Google Forest
      '#007B83', // Ocean Teal
      '#E37400', // Sunlit Amber
      '#1967D2', // Sky Blue
      '#C5221F', // Terracotta Red
      '#188038', // Meadow Green
      '#12B5CB', // Lagoon Cyan
      '#8430CE'  // Plum
    ],
    kpiAccents: ['#137333', '#007B83', '#E37400', '#1967D2', '#C5221F'],
    gridColor: 'rgba(15, 23, 42, 0.08)',
    axisColor: '#475569',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#A7F3D0',
    tooltipText: '#0F172A',
    donutStroke: '#FFFFFF'
  },
  'google-dark': {
    id: 'google-dark',
    label: 'Cloud Dark',
    shortLabel: 'Dark',
    description: 'Google Cloud Console Material 3 obsidian dark mode',
    isDark: true,
    swatches: ['#8AB4F8', '#81C995', '#FDD663', '#F28B82'],
    primaryHex: '#8AB4F8',
    secondaryHex: '#81C995',
    chartPalette: [
      '#8AB4F8', // Google Dark Blue
      '#81C995', // Google Dark Green
      '#FDD663', // Google Dark Yellow
      '#F28B82', // Google Dark Red
      '#C58AF9', // Google Dark Purple
      '#78D9EC', // Google Dark Cyan
      '#FCAD70', // Google Dark Orange
      '#FF8BCB'  // Google Dark Pink
    ],
    kpiAccents: ['#8AB4F8', '#81C995', '#FDD663', '#F28B82', '#C58AF9'],
    gridColor: 'rgba(148, 163, 184, 0.14)',
    axisColor: '#94A3B8',
    tooltipBg: '#131B2A',
    tooltipBorder: '#334155',
    tooltipText: '#F8FAFC',
    donutStroke: '#0B0F19'
  }
};

export const THEME_LIST: ThemePaletteConfig[] = [
  RETAILPULSE_THEMES['google-cloud'],
  RETAILPULSE_THEMES['google-gemini'],
  RETAILPULSE_THEMES['google-sage'],
  RETAILPULSE_THEMES['google-dark']
];

const STORAGE_KEY = 'retailpulse-palette-theme';

function applyThemeToDocument(themeId: RetailPulseThemeId) {
  const cfg = RETAILPULSE_THEMES[themeId];
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.classList.toggle('dark', cfg.isDark);
  root.classList.toggle('theme-light', !cfg.isDark);
}

interface ThemeContextValue {
  themeId: RetailPulseThemeId;
  themeConfig: ThemePaletteConfig;
  setThemeId: (next: RetailPulseThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: 'google-cloud',
  themeConfig: RETAILPULSE_THEMES['google-cloud'],
  setThemeId: () => {}
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<RetailPulseThemeId>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as RetailPulseThemeId | null;
      if (saved && saved in RETAILPULSE_THEMES) {
        applyThemeToDocument(saved);
        return saved;
      }
    } catch {
      // Ignore storage access errors inside sandboxed iframes
    }
    applyThemeToDocument('google-cloud');
    return 'google-cloud';
  });

  useEffect(() => {
    applyThemeToDocument(themeId);
    try {
      window.localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      // Ignore storage restrictions
    }
  }, [themeId]);

  const setThemeId = (next: RetailPulseThemeId) => {
    applyThemeToDocument(next);
    setThemeIdState(next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      themeConfig: RETAILPULSE_THEMES[themeId],
      setThemeId
    }),
    [themeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
