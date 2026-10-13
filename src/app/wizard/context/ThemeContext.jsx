'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const themeColors = {
  dark: {
    background: 'rgb(24 24 27)',     
    surface: 'rgb(32 32 35)',        
    border: 'rgb(39 39 42)',         
    primary: '#4c7bff',              
  },
  light: {
    background: '#f9fafb',
    surface: '#ffffff',
    border: '#e5e7eb',
    primary: '#3b82f6',
  }
};

export const ThemeContext = createContext({
  isDarkMode: false,
  toggleTheme: () => {},
  colors: themeColors.light,
});

export function ThemeProvider({ children }) {
  /**
   * Stealth Dark is the default experience. New visitors get
   * dark mode regardless of OS preference. Returning visitors with a
   * saved choice still see their selection.
   */
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        return savedTheme === 'dark';
      }
    }
    return true;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
      
      const colors = isDarkMode ? themeColors.dark : themeColors.light;
      
      document.documentElement.style.setProperty('--background-color', colors.background);
      document.documentElement.style.setProperty('--surface-color', colors.surface);
      document.documentElement.style.setProperty('--border-color', colors.border);
      document.documentElement.style.setProperty('--primary-color', colors.primary);
      
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ 
      isDarkMode, 
      toggleTheme,
      colors: isDarkMode ? themeColors.dark : themeColors.light 
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
