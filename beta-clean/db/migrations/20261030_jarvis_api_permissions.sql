-- Runtime uses bookshell_app; tables are created by the migration administrator.
-- Append-only operation ledgers require no UPDATE/DELETE privilege.
BEGIN;
GRANT SELECT, INSERT ON jarvis_operations, web_mutations TO bookshell_app;
GRANT INSERT ON jarvis_operation_audit TO bookshell_app;
GRANT USAGE ON SEQUENCE jarvis_operation_audit_id_seq TO bookshell_app;
COMMIT;
