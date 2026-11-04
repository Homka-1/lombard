import { useQuery } from "@tanstack/react-query";
import { catalogApi } from "./endpoints";

const HOUR = 60 * 60 * 1000;

/** Справочники меняются редко — кэшируем на час. */
export const useCategories = () =>
  useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: catalogApi.categories,
    staleTime: HOUR,
  });

export const useMetals = () =>
  useQuery({ queryKey: ["catalog", "metals"], queryFn: catalogApi.metals, staleTime: HOUR });

export const useConditions = () =>
  useQuery({
    queryKey: ["catalog", "conditions"],
    queryFn: catalogApi.conditions,
    staleTime: HOUR,
  });
