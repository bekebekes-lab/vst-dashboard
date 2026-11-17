-- Devolver o alerta a MAIS DE UM gestor de uma vez: uma única mensagem na conversa (sem duplicar o histórico),
-- endereçada a todos. destinatario_id continua guardando o primeiro; destinatarios lista todos.
ALTER TABLE public.churn_tratativas ADD COLUMN IF NOT EXISTS destinatarios uuid[];
