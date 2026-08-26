'use strict';

/**
 * Mapbox-backed geocoding + routing, proxied through our API.
 *
 * WHY A PROXY: the client apps previously called photon.komoot.io and
 * nominatim.openstreetmap.org directly. Those cover OSM data only, which in
 * Ghana means most commercial POIs simply do not exist — searching "IPMC
 * showroom" returned an empty list. Mapbox's Search Box API carries commercial
 * POI data and does true prefix/typeahead matching.
 *
 * The Mapbox token is a SECRET (MAPBOX_SECRET_TOKEN) and must never be shipped
 * in an app bundle, so every client request goes through here. This also gives
 * us one place to cache, rate-limit and fall back to the free OSM stack if the
 * Mapbox quota is exhausted or the token is missing.
 */

const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { realisticDurationMin } = require('../../utils/geo');

/** Accra — bias for autocomplete when the caller sends no proximity. */
const DEFAULT_PROXIMITY = { lng: -0.187, lat: 5.6037 };

const SEARCH_TIMEOUT_MS = 6000;
const DIRECTIONS_TIMEOUT_MS = 8000;

/**
 * POI SEARCH — read before changing these URLs.
 *
 * `https://api.mapbox.com/search/geocode/v6/forward` (what this used to call)
 * is the GEOCODING API. Its feature types are country/region/postcode/district/
 * place/locality/neighborhood/street/address — there is **no `poi` type at all**.
 * A comment here previously claimed v6 forward "shares Search Box's POI index";
 * it does not, which is why searching a business by name ("IPMC showroom")
 * returned nothing however the query was phrased.
 *
 * Commercial POIs live in the **Search Box API**. Its `/suggest` endpoint needs a
 * session token plus a second `/retrieve` call to get coordinates, which would
 * double latency; `/forward` on the same index returns coordinates inline and
 * behaves like a one-shot geocode, so that is what we use.
 *
 * Geocoding v6 is kept as a SECOND query, not a replacement: it is still the
 * better answer for a plain street address, and merging both means neither kind
 * of query comes back empty.
 */
const SEARCHBOX_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
const SEARCHBOX_SUGGEST_URL = 'https://api.mapbox.com/search/searchbox/v1/suggest';
const SEARCHBOX_RETRIEVE_URL = 'https://api.mapbox.com/search/searchbox/v1/retrieve';
const SEARCH_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const REVERSE_URL = 'https://api.mapbox.com/search/geocode/v6/reverse';

/**
 * How many suggestions we are willing to pay a /retrieve round-trip for.
 *
 * /suggest returns no coordinates — every row costs a second call before it can
 * be shown as a destination. They run in parallel, so the wall-clock cost is one
 * extra round trip regardless of N, but the billing cost is not. Six is more
 * than fits on screen above the fold.
 */
const SUGGEST_RETRIEVE_LIMIT = 6;

/**
 * Search Box POI categories worth surfacing for a ride destination. Passing
 * `types` keeps the response focused on things a rider would name out loud
 * rather than administrative polygons.
 */
const SEARCHBOX_TYPES = 'poi,address,street,place,neighborhood,locality';

function hasMapbox() {
  const t = env.MAPBOX_SECRET_TOKEN;
  return !!t && !/^(your|changeme|placeholder|xxx)/i.test(t);
}

/**
 * Mapbox v6 features → the flat shape both apps already consume
 * (`GeocodeResult` in apps/rider/utils/geocoding.ts).
 */
function mapboxToResult(f) {
  const coords = f?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const p = f.properties ?? {};
  const name = p.name || p.name_preferred || p.full_address || p.place_formatted;
  if (!name) return null;

  /**
   * `place_formatted` IS NOT AN ADDRESS — IT IS THE CONTEXT AROUND ONE.
   *
   * BUGFIX (item 1: "any location I choose gets put in the field as Accra,
   * which is wrong — the driver wouldn't be able to know where exactly the
   * rider is").
   *
   * Mapbox splits a feature into `name` ("Accra Mall", "Oxford Street") and
   * `place_formatted`, which is the administrative context and NOTHING ELSE:
   * literally "Accra, Greater Accra, Ghana". `full_address` is the two already
   * joined — and a POI feature very often has the context and no full address.
   *
   * This chain fell through to `place_formatted` on its own, so for exactly
   * those features `fullAddress` became the city. The rider app stores
   * `address: place.fullAddress`, `requestRide` persists it as
   * `Trip.pickupAddress`, and the driver's screen printed "Accra, Greater
   * Accra, Ghana" for a specific kerb. Every symptom in item 1 is this one line.
   *
   * Composing them keeps the identifying half in front of the context, and the
   * `startsWith` guard means a feature that already carries a composed
   * `full_address` is not prefixed with its own name a second time.
   */
  const context = p.place_formatted || null;
  let fullAddress = p.full_address || null;
  if (!fullAddress) {
    fullAddress =
      context && !context.toLowerCase().startsWith(String(name).toLowerCase())
        ? `${name}, ${context}`
        : context || name;
  }

  return {
    placeId: p.mapbox_id || `${latitude.toFixed(5)},${longitude.toFixed(5)}`,
    name,
    fullAddress,
    latitude,
    longitude,
    // `poi` results are businesses/landmarks; the apps use this to pick an icon.
    kind: p.feature_type || 'place',
  };
}

/**
 * Search Box AUTOCOMPLETE — /suggest followed by /retrieve.
 *
 * WHY, given /forward already queries the same index: they are not the same
 * query. /forward is a one-shot geocode — it wants something close to the whole
 * name and ranks by match quality. /suggest is the typeahead endpoint, and it is
 * what Uber, Bolt and Yango are actually calling. It resolves partial words and
 * misspellings ("accra mal", "kotoka intl") that /forward answers with nothing,
 * which is the difference the rider is describing: the place is in the index,
 * their half-typed query just never reached it.
 *
 * The cost is that /suggest returns no coordinates, only a `mapbox_id` — each
 * row needs a /retrieve to become a destination. The two calls share a
 * `session_token` so Mapbox bills them as one session rather than N geocodes.
 * We mint the token per search request: sessions are meant to span a rider's
 * whole typing burst, but the API is stateless and the apps do not carry one, so
 * per-request is the honest choice until they do.
 *
 * Failure returns null, not [] — see searchOnce: a provider that errored has
 * told us nothing, one that answered empty has told us the place isn't indexed.
 */
async function searchboxSuggest(query, limit, proximity, country) {
  const sessionToken = `eyego-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let suggestions;
  try {
    const { data } = await axios.get(SEARCHBOX_SUGGEST_URL, {
      params: {
        q: query,
        limit: Math.min(limit, 10),
        country,
        language: 'en',
        types: SEARCHBOX_TYPES,
        proximity: `${proximity.lng},${proximity.lat}`,
        session_token: sessionToken,
        access_token: env.MAPBOX_SECRET_TOKEN,
      },
      timeout: SEARCH_TIMEOUT_MS,
    });
    suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  } catch (err) {
    logger.warn(`Mapbox Search Box suggest failed for "${query}": ${err.message}`);
    return null;
  }

  const ids = suggestions
    .map((s) => s?.mapbox_id)
    .filter((id) => typeof id === 'string' && id.length > 0)
    .slice(0, SUGGEST_RETRIEVE_LIMIT);
  if (!ids.length) return [];

  // Parallel, and one failed retrieve must not lose the other five.
  const retrieved = await Promise.all(
    ids.map((id) =>
      axios
        .get(`${SEARCHBOX_RETRIEVE_URL}/${encodeURIComponent(id)}`, {
          params: { session_token: sessionToken, access_token: env.MAPBOX_SECRET_TOKEN },
          timeout: SEARCH_TIMEOUT_MS,
        })
        .then(({ data }) => mapboxToResult(data?.features?.[0]))
        .catch((err) => {
          logger.warn(`Mapbox retrieve failed for ${id}: ${err.message}`);
          return null;
        }),
    ),
  );

  return retrieved.filter(Boolean);
}

/**
 * Photon fallback. Kept because it is the only free provider that does prefix
 * matching — if Mapbox is down or unconfigured the search box still works,
 * just with OSM-only coverage.
 */
async function photonSearch(query, limit, proximity) {
  try {
    const { data } = await axios.get('https://photon.komoot.io/api/', {
      params: { q: query, limit, lang: 'en', lat: proximity.lat, lon: proximity.lng },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: SEARCH_TIMEOUT_MS,
    });
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((f) => {
        const c = f.geometry?.coordinates;
        if (!Array.isArray(c) || c.length !== 2) return null;
        const [longitude, latitude] = c;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const p = f.properties ?? {};
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const name = p.name || street || p.district || p.city;
        if (!name) return null;
        const fullAddress = [name, p.district, p.city, p.state, p.country]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(', ');
        return {
          placeId: String(p.osm_id ?? `${latitude.toFixed(5)},${longitude.toFixed(5)}`),
          name,
          fullAddress: fullAddress || name,
          latitude,
          longitude,
          kind: p.osm_value || 'place',
        };
      })
      .filter(Boolean);
  } catch (err) {
    // null (not []) so searchOnce can tell "provider down" from "no such place".
    logger.warn(`Photon search failed for "${query}": ${err.message}`);
    return null;
  }
}

/**
 * Nominatim forward search. Slower and no prefix matching, but its Ghanaian
 * business coverage is the best of the free providers — measured against the
 * live APIs, "IPMC" and "Accra Mall" both resolve here and in Photon while
 * Mapbox (Search Box /forward, /suggest AND Geocoding v5/v6) returns zero
 * features for either. Mapbox is still queried first for street addresses, but
 * it cannot be the only POI source for this market.
 */
async function nominatimSearch(query, limit, proximity, country) {
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        addressdetails: 1,
        countrycodes: country,
        limit,
      },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: SEARCH_TIMEOUT_MS,
    });
    if (!Array.isArray(data)) return [];
    return data
      .map((r) => {
        const latitude = parseFloat(r.lat);
        const longitude = parseFloat(r.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const a = r.address ?? {};
        const name =
          r.name || a.road || a.neighbourhood || a.suburb || a.town || a.city ||
          String(r.display_name || '').split(',')[0];
        if (!name) return null;
        return {
          placeId: String(r.place_id),
          name,
          fullAddress: tidyOsmAddress(r.display_name) || name,
          latitude,
          longitude,
          kind: r.type || 'place',
        };
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`Nominatim search failed for "${query}": ${err.message}`);
    return null;
  }
}

/** Ghana's bounding box — the only region EyeGo operates in. */
const GHANA_BOUNDS = { minLat: 4.5, maxLat: 11.5, minLng: -3.5, maxLng: 1.5 };
function withinGhana(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= GHANA_BOUNDS.minLat && lat <= GHANA_BOUNDS.maxLat &&
    lng >= GHANA_BOUNDS.minLng && lng <= GHANA_BOUNDS.maxLng
  );
}

/** Two hits within ~11 m are the same place to a rider. */
function dedupeKey(r) {
  return `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

/**
 * Generic venue nouns riders append to a business name. Every provider tested
 * returns ZERO results for "IPMC showroom" and three for "IPMC" — the extra word
 * is not in the place's name, and none of these geocoders tolerate that. So when
 * the full phrase finds nothing, the query is relaxed rather than the rider being
 * told their destination does not exist.
 *
 * Deliberately excludes words that are part of real Ghanaian place names
 * ("junction", "circle", "market", "station", "roundabout") — dropping those
 * would turn a findable place into an unfindable one.
 */
const GENERIC_VENUE_WORDS = new Set([
  'showroom', 'shop', 'store', 'outlet', 'branch', 'office', 'offices',
  'building', 'block', 'centre', 'center', 'complex', 'plaza', 'shopping',
  'head', 'hq', 'headquarters', 'main', 'ltd', 'limited', 'company', 'co',
  'the', 'at', 'in', 'near', 'by',
]);

/**
 * Progressively looser variants of a query, most specific first. Stops early:
 * each variant is only tried if everything before it came back empty.
 */
function queryVariants(raw) {
  const variants = [raw];
  const tokens = raw.split(/\s+/).filter(Boolean);

  // 1. Same query minus the generic venue nouns ("IPMC showroom" → "IPMC").
  const significant = tokens.filter((t) => !GENERIC_VENUE_WORDS.has(t.toLowerCase()));
  const withoutGeneric = significant.join(' ');
  if (withoutGeneric && withoutGeneric !== raw) variants.push(withoutGeneric);

  // 2. The distinctive head of the name — the longest remaining token, which for
  //    "IPMC showroom east legon" is the brand rather than the district.
  if (significant.length > 1) {
    const longest = [...significant].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 3 && !variants.includes(longest)) variants.push(longest);
  }

  return variants;
}

/** Rank by closeness to the rider: three IPMC branches should list nearest first. */
function sortByProximity(results, proximity) {
  return [...results].sort(
    (a, b) =>
      haversineKm(proximity.lat, proximity.lng, a.latitude, a.longitude) -
      haversineKm(proximity.lat, proximity.lng, b.latitude, b.longitude),
  );
}

/**
 * Forward search across every provider we have, with query relaxation.
 *
 * Returns `{ results, meta }`: `meta.providersFailed` lets the client say
 * "search is unavailable, try again" instead of "no such place", which are very
 * different things to a rider standing on a street corner.
 */
async function searchPlacesDetailed({ query, limit = 8, lat, lng, country = 'gh' }) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return { results: [], meta: { relaxedTo: null, providersFailed: false } };

  const proximity =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DEFAULT_PROXIMITY;

  for (const variant of queryVariants(trimmed)) {
    const { results, providersFailed } = await searchOnce({ query: variant, limit, proximity, country });
    if (results.length) {
      return {
        results: sortByProximity(results, proximity).slice(0, limit),
        meta: { relaxedTo: variant === trimmed ? null : variant, providersFailed },
      };
    }
    // Every provider erroring is not the same as every provider agreeing there is
    // no such place — stop and say so rather than relaxing into more failures.
    if (providersFailed) {
      return { results: [], meta: { relaxedTo: null, providersFailed: true } };
    }
  }

  return { results: [], meta: { relaxedTo: null, providersFailed: false } };
}

/** Back-compat: callers that only want the rows. */
async function searchPlaces(args) {
  const { results } = await searchPlacesDetailed(args);
  return results;
}

/** One pass over every provider for exactly one query string. */
async function searchOnce({ query: trimmed, limit, proximity, country }) {
  const tasks = [
    photonSearch(trimmed, limit, proximity),
    nominatimSearch(trimmed, limit, proximity, country),
  ];

  if (hasMapbox()) {
    // Geocoding v6 — precise for street addresses, blind to businesses.
    tasks.unshift(
      axios
        .get(SEARCH_URL, {
          params: {
            q: trimmed,
            limit,
            country,
            language: 'en',
            proximity: `${proximity.lng},${proximity.lat}`,
            access_token: env.MAPBOX_SECRET_TOKEN,
          },
          timeout: SEARCH_TIMEOUT_MS,
        })
        .then(({ data }) => (Array.isArray(data?.features) ? data.features : []).map(mapboxToResult).filter(Boolean))
        // `null`, not `[]`: a provider that ERRORED has told us nothing, whereas
        // one that answered with no features has told us this place isn't in its
        // index. searchOnce needs to distinguish the two.
        .catch((err) => {
          logger.warn(`Mapbox geocode search failed for "${trimmed}": ${err.message}`);
          return null;
        }),
    );

    // Search Box — the ONLY source here that indexes businesses/landmarks.
    // Queried first so a named POI outranks a same-named street.
    //
    // Both of its endpoints are queried, because they answer differently:
    // /forward is a one-shot geocode, /suggest is the typeahead the other ride
    // apps use and is the one that tolerates a half-typed name. Merged and
    // deduped by coordinate below, so overlap costs nothing visible.
    tasks.unshift(searchboxSuggest(trimmed, limit, proximity, country));

    tasks.unshift(
      axios
        .get(SEARCHBOX_URL, {
          params: {
            q: trimmed,
            // Search Box caps `limit` at 10.
            limit: Math.min(limit, 10),
            country,
            language: 'en',
            types: SEARCHBOX_TYPES,
            proximity: `${proximity.lng},${proximity.lat}`,
            access_token: env.MAPBOX_SECRET_TOKEN,
          },
          timeout: SEARCH_TIMEOUT_MS,
        })
        .then(({ data }) => (Array.isArray(data?.features) ? data.features : []).map(mapboxToResult).filter(Boolean))
        .catch((err) => {
          logger.warn(`Mapbox Search Box failed for "${trimmed}": ${err.message}`);
          return null;
        }),
    );
  }

  const groups = await Promise.all(tasks);
  const answered = groups.filter(Array.isArray);
  const seen = new Set();
  const merged = [];
  for (const r of answered.flat()) {
    // Photon takes a proximity bias but no country filter, and a relaxed query
    // widens the net further — "zzzqqq nonexistent place" was matching a swamp
    // trail on another continent. EyeGo operates in Ghana; anything outside it is
    // never the place the rider meant.
    if (!withinGhana(r.latitude, r.longitude)) continue;
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return {
    results: merged.slice(0, limit),
    // Not one provider managed to answer — the network or every upstream is down.
    providersFailed: answered.length === 0,
  };
}

/**
 * WHAT A REVERSE GEOCODE IS ALLOWED TO ANSWER WITH, MOST SPECIFIC FIRST.
 *
 * BUGFIX (item 7: "the location street address shown is always the approximate
 * city and not the actual street name — I picked a location and it showed
 * 'Accra, Greater Accra, Ghana'").
 *
 * The call below passed no `types` at all. Mapbox's reverse endpoint then
 * returns its own highest-confidence feature for the point, and over most of
 * Accra — where address-level coverage is thin — that is the `place` polygon,
 * i.e. the city. Ranked correctly by Mapbox and useless to a rider: "Accra" does
 * not tell a driver which kerb to stop at.
 *
 * So the point is asked THREE times, narrowest first. `address` is a numbered
 * building, `street` is the road it stands on, `poi` is the landmark a Ghanaian
 * rider is far more likely to name than either. Only when none of those exists
 * do we fall through to the wide types and print the neighbourhood or the city —
 * which is then the honest answer rather than a lazy one.
 *
 * Cost: one extra round trip ONLY when the specific pass finds nothing, because
 * each tier returns as soon as it has a hit. `placeNameFor` in
 * services/mapbox.service.js caches by rounded coordinate for a day, and this
 * endpoint is behind the picker's own debounce.
 */
const MAPBOX_PRECISE_TIERS = ['address,street', 'poi'];

/**
 * The wide tier is a LAST resort, and it now sits behind OSM rather than in
 * front of it.
 *
 * BUGFIX, second pass ("on the driver create-trip page it still has the same
 * issue of the data put in the address fields as just Accra and nothing else",
 * and the same on the rider's saved places). Splitting the tiers was right and
 * it was not enough. Over most of Accra, Mapbox has no `address`, `street` or
 * `poi` feature at all — measured, at the exact point that produced the report:
 *
 *     mapbox address,street            → nothing
 *     mapbox poi                       → nothing
 *     mapbox neighborhood,locality,place → "Accra, Greater Accra, Ghana"
 *     nominatim (OSM)                  → "Obuakon Avenue, Shiashie, East Legon"
 *
 * Because the third Mapbox tier answered, the OSM branch below — which had the
 * street name all along — was never reached. Every pin in that (large) part of
 * the city therefore resolved to the city itself, and both apps faithfully
 * stored and displayed "Accra" as an address.
 *
 * OSM's Ghana coverage is street-level and community-mapped; Mapbox's is
 * strongest on POIs. Asking the precise Mapbox tiers first, then OSM, then
 * Mapbox's administrative fallback, plays each to its strength and only prints
 * "Accra" when nobody, anywhere, knows anything more specific about the point.
 */
const MAPBOX_WIDE_TIER = 'neighborhood,locality,place';

/**
 * OSM's `display_name` IS AN ADMINISTRATIVE PATH, NOT A POSTAL ADDRESS.
 *
 * It runs all the way up to the country and includes the district and postcode:
 *
 *   "Obuakon Avenue, Shiashie, East Legon, Accra, Ayawaso West Municipal
 *    District, Greater Accra Region, GD-110-6313, Ghana"
 *
 * A driver glancing at a trip card, or a rider confirming a pickup, needs the
 * first three of those and none of the rest — and this string is stored on the
 * Trip and the Route, so the noise is carried into every screen that renders
 * them. Nobody in Accra says the region, the district or the digital address
 * when telling a driver where to go.
 */
const OSM_NOISE = /^(gh|ghana|greater accra region|greater accra|[A-Z]{2}-\d{3}-\d{4})$/i;
const OSM_DISTRICT = /\b(municipal|metropolitan|district assembly)\b/i;

function tidyOsmAddress(displayName) {
  if (!displayName) return displayName;
  const parts = String(displayName)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !OSM_NOISE.test(s) && !OSM_DISTRICT.test(s));
  // Four components is a street, a neighbourhood, a suburb and a city — the
  // most anyone reads before they stop reading.
  return parts.slice(0, 4).join(', ');
}

/** One reverse call to Mapbox for a given `types` filter. Null when it has nothing. */
async function mapboxReverse(lat, lng, types) {
  try {
    const { data } = await axios.get(REVERSE_URL, {
      params: {
        longitude: lng,
        latitude: lat,
        limit: 1,
        types,
        language: 'en',
        access_token: env.MAPBOX_SECRET_TOKEN,
      },
      timeout: SEARCH_TIMEOUT_MS,
    });
    const mapped = mapboxToResult(data?.features?.[0]);
    return mapped ? { ...mapped, latitude: lat, longitude: lng } : null;
  } catch (err) {
    // A 422 here means "no feature of these types at this point", which is
    // the ordinary case for the narrow tiers and not worth a warning line.
    if (err?.response?.status !== 422) {
      logger.warn(`Mapbox reverse (${types}) failed at ${lat},${lng}: ${err.message}`);
    }
    return null;
  }
}

/** Reverse geocode for the map-pin picker. Coordinates stay the caller's. */
async function reverseGeocode({ lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (hasMapbox()) {
    for (const types of MAPBOX_PRECISE_TIERS) {
      const hit = await mapboxReverse(lat, lng, types);
      if (hit) return hit;
    }
  }

  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon: lng, format: 'json', addressdetails: 1, zoom: 18 },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: SEARCH_TIMEOUT_MS,
    });
    if (data && !data.error && data.display_name) {
      const a = data.address ?? {};
      /**
       * SAME RULE, OSM'S VOCABULARY.
       *
       * `data.name` led this chain and is the reason Nominatim answered with a
       * city too: on a reverse lookup that resolves to an administrative area,
       * `name` IS "Accra". A house number and road beat every one of these when
       * they exist, so they go first, and the bare `name` drops to where it
       * belongs — after the road, the suburb and the neighbourhood.
       */
      const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway].filter(Boolean).join(' ');
      const name =
        street ||
        a.building ||
        a.amenity ||
        a.shop ||
        a.neighbourhood ||
        a.suburb ||
        data.name ||
        a.village ||
        a.town ||
        a.city ||
        String(data.display_name).split(',')[0];
      return {
        placeId: String(data.place_id),
        name,
        fullAddress: tidyOsmAddress(data.display_name),
        latitude: lat,
        longitude: lng,
        kind: street ? 'address' : 'place',
      };
    }
  } catch (err) {
    logger.warn(`Nominatim reverse failed at ${lat},${lng}: ${err.message}`);
  }

  // Nobody knows a street, a landmark or a neighbourhood here. The city is now
  // the honest answer rather than the lazy one — see MAPBOX_WIDE_TIER.
  if (hasMapbox()) {
    const wide = await mapboxReverse(lat, lng, MAPBOX_WIDE_TIER);
    if (wide) return { ...wide, approximate: true };
  }
  return null;
}

/**
 * Average driving speed used only when no routing provider answers.
 *
 * 22 km/h, not the 40+ km/h a naive "distance / highway speed" model implies.
 * Accra's observed mean urban speed sits in the low twenties once junctions,
 * traffic lights and congestion are counted, which is why the old estimate
 * claimed 8.3 km would take 12 minutes (≈41 km/h — motorway pace, in traffic).
 */
const FALLBACK_URBAN_KMH = 22;

/** Straight-line km between two points. */
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Road distance is always longer than the straight line. 1.35 is the standard
 * circuity factor for a dense urban grid — without it every fallback ETA is
 * optimistic by roughly a third before traffic is even considered.
 */
const CIRCUITY_FACTOR = 1.35;

/**
 * Route between two points.
 *
 * Uses the `driving-traffic` profile, NOT `driving`: the plain profile returns
 * free-flow duration (what the trip would take on an empty road at 3am), which
 * is exactly the "8.3 km in 12 minutes" number the driver app was showing.
 * `driving-traffic` folds in live and historical congestion.
 *
 * Returns null only when there is no usable answer at all; a provider failure
 * degrades to the haversine estimate rather than to nothing, because callers
 * use this for fare and ETA and must not render a blank.
 */
async function getRoute({ originLat, originLng, destLat, destLng, profile = 'driving-traffic' }) {
  const coords = [originLat, originLng, destLat, destLng];
  if (!coords.every(Number.isFinite)) return null;

  if (hasMapbox()) {
    try {
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/` +
        `${originLng},${originLat};${destLng},${destLat}`;
      const { data } = await axios.get(url, {
        params: {
          geometries: 'geojson',
          overview: 'full',
          steps: false,
          alternatives: false,
          annotations: 'duration,distance',
          access_token: env.MAPBOX_SECRET_TOKEN,
        },
        timeout: DIRECTIONS_TIMEOUT_MS,
      });
      const route = data?.routes?.[0];
      if (route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
        const distanceKm = route.distance / 1000;
        return {
          distanceKm,
          // Even on the traffic profile, Mapbox falls back to posted limits where
          // it has no congestion data — which is most of Ghana. See
          // `realisticDurationMin`: this can only lengthen the answer.
          durationMin: realisticDurationMin(route.duration / 60, distanceKm),
          geometry: route.geometry,
          source: profile,
        };
      }
    } catch (err) {
      logger.warn(`Mapbox directions failed: ${err.message}`);
    }
  }

  // OSRM's public demo server is free-flow only and rate-limited, so it is a
  // second-choice source rather than a peer of Mapbox — but its geometry beats
  // a straight line for drawing a polyline.
  try {
    const { data } = await axios.get(
      `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}`,
      { params: { overview: 'full', geometries: 'geojson' }, timeout: DIRECTIONS_TIMEOUT_MS },
    );
    const route = data?.routes?.[0];
    if (route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
      const distanceKm = route.distance / 1000;
      // OSRM duration assumes free flow. Re-time the real road distance at the
      // urban average instead of trusting it, then keep whichever is slower.
      const congested = (distanceKm / FALLBACK_URBAN_KMH) * 60;
      return {
        distanceKm,
        durationMin: Math.max(route.duration / 60, congested),
        geometry: route.geometry,
        source: 'osrm',
      };
    }
  } catch (err) {
    logger.warn(`OSRM directions failed: ${err.message}`);
  }

  const straight = haversineKm(originLat, originLng, destLat, destLng);
  const distanceKm = straight * CIRCUITY_FACTOR;
  return {
    distanceKm,
    durationMin: (distanceKm / FALLBACK_URBAN_KMH) * 60,
    geometry: {
      type: 'LineString',
      coordinates: [
        [originLng, originLat],
        [destLng, destLat],
      ],
    },
    source: 'estimate',
  };
}

/**
 * ETA only, for the many callers that need minutes and nothing else
 * (driver→pickup countdown, dispatch cards, tracking header).
 */
async function getEtaMinutes({ originLat, originLng, destLat, destLng }) {
  const route = await getRoute({ originLat, originLng, destLat, destLng });
  return route ? Math.max(1, Math.round(route.durationMin)) : null;
}

module.exports = {
  searchPlaces,
  searchPlacesDetailed,
  reverseGeocode,
  getRoute,
  getEtaMinutes,
  haversineKm,
  hasMapbox,
  FALLBACK_URBAN_KMH,
  CIRCUITY_FACTOR,
};
