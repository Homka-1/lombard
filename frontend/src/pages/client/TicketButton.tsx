import { useMutation } from "@tanstack/react-query";
import { loansApi } from "../../api/endpoints";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";

/**
 * Залоговый билет — HTML с backend (нужен заголовок Authorization, поэтому не обычная ссылка):
 * скачиваем и открываем в новой вкладке, где его можно распечатать или сохранить в PDF.
 */
export function TicketButton({
  ticketUrl,
  ticketNumber,
  size,
}: {
  ticketUrl: string;
  ticketNumber: string;
  size?: "m" | "l";
}) {
  const toast = useToast();
  const open = useMutation({
    mutationFn: () => loansApi.ticket(ticketUrl),
    onSuccess: (html) => {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const win = window.open(url, "_blank");
      if (!win) {
        // всплывающие окна заблокированы — сохраняем файлом
        const a = document.createElement("a");
        a.href = url;
        a.download = `zalogovyj-bilet-${ticketNumber}.html`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (err) =>
      toast.show({ title: "Не удалось открыть билет", text: err.message, tone: "danger" }),
  });
  return (
    <Button
      variant="secondary"
      size={size}
      icon="doc"
      loading={open.isPending}
      onClick={() => open.mutate()}
    >
      Залоговый билет
    </Button>
  );
}
