-- Local synthetic development only, applied to a fresh Compose volume.
CREATE DATABASE meetwell_test OWNER meetwell_dev;
CREATE ROLE meetwell_worker_dev LOGIN PASSWORD 'local-worker-only' NOSUPERUSER NOCREATEDB NOCREATEROLE;
