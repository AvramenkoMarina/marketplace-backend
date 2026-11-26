import './observability/otel';
import { startObserveServer } from './observability/server';

const raw = Number(process.env.PORT ?? '0');
const port = Number.isInteger(raw) && raw >= 0 ? raw : 0;
startObserveServer(port);
