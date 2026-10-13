import express from 'express';
import request from 'supertest';
import { trustProxyHops } from './client-ip';

// The chain seen in production on Fly: X-Forwarded-For "<visitor>, <edge>", arriving from Fly's internal proxy.
it("makes req.ip the visitor for Fly's two hops, not the edge", async () => {
  const app = express();
  app.set('trust proxy', trustProxyHops({ FLY_APP_NAME: 'discuva-api' }));
  app.get('/', (req, res) => {
    res.json({ ip: req.ip });
  });
  const res = await request(app)
    .get('/')
    .set('X-Forwarded-For', '102.212.253.9, 66.241.124.132');
  expect(res.body.ip).toBe('102.212.253.9');
});
