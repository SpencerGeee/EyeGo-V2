const { chainFor, placeOnChain, nearestStop } = require('../src/utils/route-chain');

// Kasoa → Shiashie, two stops on the way.
const route = {
  originName: 'Kasoa', originLat: 5.53, originLng: -0.42,
  destinationName: 'Shiashie', destLat: 5.63, destLng: -0.17,
  virtualStops: [
    { id: 's2', name: 'Kaneshie', lat: 5.57, lng: -0.24, sequence: 2 },
    { id: 's1', name: 'Weija', lat: 5.55, lng: -0.33, sequence: 1 },
  ],
};

describe('route chain', () => {
  const chain = chainFor(route);

  test('stops are ordered by sequence between origin and destination', () => {
    expect(chain.points.map((p) => p.name)).toEqual(['Kasoa', 'Weija', 'Kaneshie', 'Shiashie']);
  });

  test('a rider at Weija going to Kaneshie travels forward', () => {
    const a = placeOnChain(chain, 5.551, -0.331);
    const b = placeOnChain(chain, 5.571, -0.241);
    expect(a.ratio).toBeLessThan(b.ratio);
    expect(a.offKm).toBeLessThan(0.5);
  });

  test('the stop nearest a ratio, only after the pickup', () => {
    const weija = placeOnChain(chain, 5.55, -0.33).ratio;
    expect(nearestStop(chain, weija)?.id).toBe('s1');
    expect(nearestStop(chain, weija, { after: weija })?.id).toBe('s2');
  });
});
