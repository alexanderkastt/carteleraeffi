import { useState, useEffect, useCallback } from 'react';
import { BenchmarkData, CellValue, carriersByCountry, fields, normalizeCellValue } from '@/lib/data';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'efficommerce_benchmark_data';

interface StoredData {
  [key: string]: BenchmarkData; // key format: "country_year_month"
}

// Hydrate localStorage from Supabase saved_reports if local data is missing or empty
async function hydrateFromSupabase(): Promise<boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const existing: StoredData = stored ? JSON.parse(stored) : {};

    // Check if any period has real data (not just empty defaults)
    const hasRealData = Object.values(existing).some(periodData =>
      Object.values(periodData).some(carrier =>
        Object.values(carrier).some(cell => {
          const val = (cell as CellValue).value;
          return val !== '' && val !== false && val !== 0;
        })
      )
    );

    if (hasRealData) return false;

    const { data: reports, error } = await supabase
      .from('saved_reports')
      .select('country, year, month, data');
    if (error || !reports || reports.length === 0) return false;

    const allData: StoredData = {};
    reports.forEach((r: any) => {
      allData[`${r.country}_${r.year}_${r.month}`] = r.data as BenchmarkData;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    console.log(`Hydrated ${reports.length} periods from Supabase`);
    return true;
  } catch (e) {
    console.error('Hydrate error:', e);
    return false;
  }
}

export function useBenchmarkData(country: string, year: number, month: number) {
  const [data, setData] = useState<BenchmarkData>({});
  const [isSaving, setIsSaving] = useState(false);

  const storageKey = `${country}_${year}_${month}`;

  // Load data from localStorage, hydrate from Supabase if needed
  useEffect(() => {
    async function loadData() {
      await hydrateFromSupabase();
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const allData: StoredData = JSON.parse(stored);
          if (allData[storageKey]) {
            const loadedData = allData[storageKey];
            const normalizedData: BenchmarkData = {};
            Object.keys(loadedData).forEach(carrier => {
              normalizedData[carrier] = {};
              Object.keys(loadedData[carrier]).forEach(fieldId => {
                normalizedData[carrier][fieldId] = normalizeCellValue(loadedData[carrier][fieldId]);
              });
            });
            setData(normalizedData);
          } else {
            initializeData();
          }
        } else {
          initializeData();
        }
      } catch (error) {
        console.error('Error loading benchmark data:', error);
        initializeData();
      }
    }
    loadData();
  }, [country, year, month, storageKey]);

  const initializeData = () => {
    const carriers = carriersByCountry[country] || [];
    const initialData: BenchmarkData = {};
    carriers.forEach(carrier => {
      initialData[carrier] = {};
      fields.forEach(field => {
        const defaultValue = field.type === 'boolean' ? false : '';
        initialData[carrier][field.id] = { value: defaultValue, note: '', color: 'none' };
      });
    });
    setData(initialData);
  };

  // Save data to localStorage
  const saveData = useCallback((newData: BenchmarkData) => {
    setIsSaving(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const allData: StoredData = stored ? JSON.parse(stored) : {};
      allData[storageKey] = newData;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    } catch (error) {
      console.error('Error saving benchmark data:', error);
    } finally {
      setTimeout(() => setIsSaving(false), 500);
    }
  }, [storageKey]);

  // Update a single cell
  const updateCell = useCallback((carrier: string, fieldId: string, cellValue: CellValue) => {
    setData(prevData => {
      const newData: BenchmarkData = {
        ...prevData,
        [carrier]: {
          ...prevData[carrier],
          [fieldId]: cellValue
        }
      };
      saveData(newData);
      return newData;
    });
  }, [saveData]);

  // Get all saved periods
  const getSavedPeriods = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const allData: StoredData = JSON.parse(stored);
        return Object.keys(allData).map(key => {
          const [country, year, month] = key.split('_');
          return { country, year: parseInt(year), month: parseInt(month) };
        });
      }
    } catch (error) {
      console.error('Error getting saved periods:', error);
    }
    return [];
  }, []);

  // Get data from a specific period
  const getDataFromPeriod = useCallback((fromCountry: string, fromYear: number, fromMonth: number): BenchmarkData | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const allData: StoredData = JSON.parse(stored);
        const periodKey = `${fromCountry}_${fromYear}_${fromMonth}`;
        if (allData[periodKey]) {
          const loadedData = allData[periodKey];
          const normalizedData: BenchmarkData = {};
          Object.keys(loadedData).forEach(carrier => {
            normalizedData[carrier] = {};
            Object.keys(loadedData[carrier]).forEach(fieldId => {
              normalizedData[carrier][fieldId] = normalizeCellValue(loadedData[carrier][fieldId]);
            });
          });
          return normalizedData;
        }
      }
    } catch (error) {
      console.error('Error getting data from period:', error);
    }
    return null;
  }, []);

  // Copy data from another period (only fields from "beneficios" onwards)
  const copyFromPeriod = useCallback((fromCountry: string, fromYear: number, fromMonth: number): boolean => {
    const sourceData = getDataFromPeriod(fromCountry, fromYear, fromMonth);
    if (sourceData) {
      // Get the index of "beneficios" field to know which fields to copy
      const beneficiosIndex = fields.findIndex(f => f.id === 'beneficios');
      const fieldsToCopy = fields.slice(beneficiosIndex).map(f => f.id);
      
      // Filter only carriers that exist in current country
      const currentCarriers = carriersByCountry[country] || [];
      const filteredData: BenchmarkData = { ...data }; // Keep existing data
      
      currentCarriers.forEach(carrier => {
        if (!filteredData[carrier]) {
          filteredData[carrier] = {};
        }
        
        // Only copy fields from "beneficios" onwards
        if (sourceData[carrier]) {
          fieldsToCopy.forEach(fieldId => {
            if (sourceData[carrier][fieldId]) {
              filteredData[carrier][fieldId] = sourceData[carrier][fieldId];
            }
          });
        }
        
        // Ensure all other fields exist (keep existing or initialize)
        fields.forEach(field => {
          if (!filteredData[carrier][field.id]) {
            const defaultValue = field.type === 'boolean' ? false : '';
            filteredData[carrier][field.id] = { value: defaultValue, note: '', color: 'none' };
          }
        });
      });
      
      setData(filteredData);
      saveData(filteredData);
      return true;
    }
    return false;
  }, [country, data, getDataFromPeriod, saveData]);

  // Get previous month info
  const getPreviousMonth = useCallback(() => {
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear = year - 1;
    }
    return { month: prevMonth, year: prevYear };
  }, [month, year]);

  // Check if previous month has data
  const hasPreviousMonthData = useCallback(() => {
    const { month: prevMonth, year: prevYear } = getPreviousMonth();
    const data = getDataFromPeriod(country, prevYear, prevMonth);
    return data !== null && Object.keys(data).length > 0;
  }, [country, getPreviousMonth, getDataFromPeriod]);

  return {
    data,
    updateCell,
    isSaving,
    getSavedPeriods,
    copyFromPeriod,
    getPreviousMonth,
    hasPreviousMonthData,
    getDataFromPeriod
  };
}
