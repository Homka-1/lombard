import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../api/endpoints";
import { useToast } from "../../components/ui/Toast";

/** Назначение курьеров: после изменения обновить выезды, курьеров и дашборд. */
export function useAssign() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (plan: { taskId: number; courierId: number }[]) =>
      Promise.all(plan.map((p) => adminApi.assign(p.taskId, p.courierId))),
    onSuccess: (done) => {
      toast.show({
        title:
          done.length === 1
            ? `Курьер ${done[0]!.courier?.full_name ?? ""} назначен`
            : `Назначено выездов: ${done.length}`,
        tone: "success",
      });
    },
    onError: (e) => toast.show({ title: "Курьер не назначен", text: e.message, tone: "danger" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}
