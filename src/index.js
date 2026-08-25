/**
 * JPL / Pasadena Transit 53 arrivals
 *
 * Cloudflare Worker that turns the agency's GTFS-Realtime protobuf into JSON.
 *
 *   GET /?stop=2707              arrivals at one stop
 *   GET /?from=1709&to=2707      same trip: depart `from`, arrive `to`
 *   GET /?stops=1                stop catalog for the widget picker
 *   GET /?refresh=1              pull the static GTFS zip into KV now
 *
 * stop / from / to accept the number on the bus sign (stop_code) or the
 * internal stop_id. Opposite curbs have different codes.
 *
 * Cron (Mon–Fri 12:30 and 22:30 UTC ≈ 5:30am / 3:30pm PDT, or 4:30am / 2:30pm
 * PST) reloads the zip so trip_id → route, headsigns, stop list, and per-trip
 * scheduled times stay current. The schedule offsets let us estimate arrivals
 * at intermediate stops when the agency only publishes 1–2 near-term
 * predictions. KV miss falls back to the baked-in FALLBACK snapshot.
 */

const GTFS_RT_URL =
  "https://rt.pasadenatransit.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate";
const GTFS_ZIP_URL =
  "https://rt.pasadenatransit.net/rtt/public/resource/gtfs.zip";

const ROUTE = "53";
const KV_KEY = "gtfs53";

// Snapshot from feed_version 20260819. Used only if KV is empty or unbound.
// Realtime often omits route_id, so we need trip_id → 53 from the static feed.
// tripStopTimes enables estimating arrivals when the agency only publishes
// a couple of near-term stop predictions (common for this feed).
const FALLBACK = {
  feed_version: "20260819",
  tripToRoute: {
    "2449": "53", "2450": "53", "2451": "53", "2452": "53",
    "2453": "53", "2454": "53", "2455": "53", "2456": "53",
    "2457": "53", "2458": "53", "2459": "53", "2460": "53",
    "2461": "53", "2462": "53", "2463": "53", "2464": "53",
    "2465": "53", "2466": "53", "2467": "53", "2468": "53",
    "2469": "53", "2470": "53", "2471": "53", "2472": "53",
    "2473": "53", "2474": "53", "2475": "53", "2476": "53",
  },
  tripHeadsign: {
    "2449": "JPL", "2450": "Caltech", "2451": "JPL", "2452": "Caltech",
    "2453": "JPL", "2454": "Caltech", "2455": "JPL", "2456": "Caltech",
    "2457": "JPL", "2458": "Caltech", "2459": "JPL", "2460": "Caltech",
    "2461": "JPL", "2462": "Caltech", "2463": "JPL", "2464": "Caltech",
    "2465": "JPL", "2466": "Caltech", "2467": "JPL", "2468": "Caltech",
    "2469": "JPL", "2470": "Caltech", "2471": "JPL", "2472": "Caltech",
    "2473": "JPL", "2474": "Caltech", "2475": "JPL", "2476": "Caltech",
  },
  tripStopTimes: {"2449":[{"id":"728","sec":21000},{"id":"116","sec":21054},{"id":"127","sec":21091},{"id":"128","sec":21119},{"id":"727","sec":21175},{"id":"726","sec":21247},{"id":"580","sec":21420},{"id":"575","sec":21453},{"id":"577","sec":21481},{"id":"689","sec":21499},{"id":"630","sec":21518},{"id":"631","sec":21547},{"id":"632","sec":21590},{"id":"595","sec":21637},{"id":"454","sec":21684},{"id":"452","sec":21713},{"id":"451","sec":21751},{"id":"732","sec":22316},{"id":"414","sec":22390},{"id":"462","sec":22440}],"2450":[{"id":"462","sec":22620},{"id":"413","sec":22678},{"id":"731","sec":22764},{"id":"461","sec":23397},{"id":"453","sec":23448},{"id":"604","sec":23486},{"id":"625","sec":23533},{"id":"626","sec":23575},{"id":"627","sec":23641},{"id":"570","sec":23677},{"id":"576","sec":23693},{"id":"574","sec":23723},{"id":"579","sec":23760},{"id":"131","sec":23903},{"id":"129","sec":23977},{"id":"118","sec":24016},{"id":"475","sec":24106},{"id":"472","sec":24145},{"id":"728","sec":24300}],"2451":[{"id":"728","sec":24660},{"id":"116","sec":24714},{"id":"127","sec":24751},{"id":"128","sec":24779},{"id":"727","sec":24835},{"id":"726","sec":24907},{"id":"580","sec":25080},{"id":"575","sec":25117},{"id":"577","sec":25148},{"id":"689","sec":25169},{"id":"630","sec":25189},{"id":"631","sec":25222},{"id":"632","sec":25270},{"id":"595","sec":25323},{"id":"454","sec":25375},{"id":"452","sec":25408},{"id":"451","sec":25450},{"id":"732","sec":26081},{"id":"414","sec":26164},{"id":"462","sec":26220}],"2452":[{"id":"462","sec":26340},{"id":"413","sec":26398},{"id":"731","sec":26484},{"id":"461","sec":27117},{"id":"453","sec":27168},{"id":"604","sec":27206},{"id":"625","sec":27253},{"id":"626","sec":27295},{"id":"627","sec":27361},{"id":"570","sec":27397},{"id":"576","sec":27413},{"id":"574","sec":27443},{"id":"579","sec":27480},{"id":"131","sec":27623},{"id":"129","sec":27697},{"id":"118","sec":27736},{"id":"475","sec":27826},{"id":"472","sec":27865},{"id":"728","sec":28020}],"2453":[{"id":"728","sec":28380},{"id":"116","sec":28434},{"id":"127","sec":28471},{"id":"128","sec":28499},{"id":"727","sec":28555},{"id":"726","sec":28627},{"id":"580","sec":28800},{"id":"575","sec":28833},{"id":"577","sec":28861},{"id":"689","sec":28879},{"id":"630","sec":28898},{"id":"631","sec":28927},{"id":"632","sec":28970},{"id":"595","sec":29017},{"id":"454","sec":29064},{"id":"452","sec":29093},{"id":"451","sec":29131},{"id":"732","sec":29696},{"id":"414","sec":29770},{"id":"462","sec":29820}],"2454":[{"id":"462","sec":30000},{"id":"413","sec":30058},{"id":"731","sec":30144},{"id":"461","sec":30777},{"id":"453","sec":30828},{"id":"604","sec":30866},{"id":"625","sec":30913},{"id":"626","sec":30955},{"id":"627","sec":31021},{"id":"570","sec":31057},{"id":"576","sec":31073},{"id":"574","sec":31103},{"id":"579","sec":31140},{"id":"131","sec":31283},{"id":"129","sec":31357},{"id":"118","sec":31396},{"id":"475","sec":31486},{"id":"472","sec":31525},{"id":"728","sec":31680}],"2455":[{"id":"728","sec":32160},{"id":"116","sec":32214},{"id":"127","sec":32251},{"id":"128","sec":32279},{"id":"727","sec":32335},{"id":"726","sec":32407},{"id":"580","sec":32580},{"id":"575","sec":32613},{"id":"577","sec":32641},{"id":"689","sec":32659},{"id":"630","sec":32678},{"id":"631","sec":32707},{"id":"632","sec":32750},{"id":"595","sec":32797},{"id":"454","sec":32844},{"id":"452","sec":32873},{"id":"451","sec":32911},{"id":"732","sec":33476},{"id":"414","sec":33550},{"id":"462","sec":33600}],"2456":[{"id":"462","sec":54900},{"id":"413","sec":54958},{"id":"731","sec":55044},{"id":"461","sec":55677},{"id":"453","sec":55728},{"id":"604","sec":55766},{"id":"625","sec":55813},{"id":"626","sec":55855},{"id":"627","sec":55921},{"id":"570","sec":55957},{"id":"576","sec":55973},{"id":"574","sec":56003},{"id":"579","sec":56040},{"id":"131","sec":56199},{"id":"129","sec":56281},{"id":"118","sec":56324},{"id":"475","sec":56424},{"id":"472","sec":56468},{"id":"728","sec":56640}],"2457":[{"id":"728","sec":57000},{"id":"116","sec":57054},{"id":"127","sec":57091},{"id":"128","sec":57119},{"id":"727","sec":57175},{"id":"726","sec":57247},{"id":"580","sec":57420},{"id":"575","sec":57453},{"id":"577","sec":57481},{"id":"689","sec":57499},{"id":"630","sec":57518},{"id":"631","sec":57547},{"id":"632","sec":57590},{"id":"595","sec":57637},{"id":"454","sec":57684},{"id":"452","sec":57713},{"id":"451","sec":57751},{"id":"732","sec":58316},{"id":"414","sec":58390},{"id":"462","sec":58440}],"2458":[{"id":"462","sec":58620},{"id":"413","sec":58678},{"id":"731","sec":58764},{"id":"461","sec":59397},{"id":"453","sec":59448},{"id":"604","sec":59486},{"id":"625","sec":59533},{"id":"626","sec":59575},{"id":"627","sec":59641},{"id":"570","sec":59677},{"id":"576","sec":59693},{"id":"574","sec":59723},{"id":"579","sec":59760},{"id":"131","sec":59919},{"id":"129","sec":60001},{"id":"118","sec":60044},{"id":"475","sec":60144},{"id":"472","sec":60188},{"id":"728","sec":60360}],"2459":[{"id":"728","sec":60720},{"id":"116","sec":60774},{"id":"127","sec":60811},{"id":"128","sec":60839},{"id":"727","sec":60895},{"id":"726","sec":60967},{"id":"580","sec":61140},{"id":"575","sec":61173},{"id":"577","sec":61201},{"id":"689","sec":61219},{"id":"630","sec":61238},{"id":"631","sec":61267},{"id":"632","sec":61310},{"id":"595","sec":61357},{"id":"454","sec":61404},{"id":"452","sec":61433},{"id":"451","sec":61471},{"id":"732","sec":62036},{"id":"414","sec":62110},{"id":"462","sec":62160}],"2460":[{"id":"462","sec":62340},{"id":"413","sec":62398},{"id":"731","sec":62484},{"id":"461","sec":63117},{"id":"453","sec":63168},{"id":"604","sec":63206},{"id":"625","sec":63253},{"id":"626","sec":63295},{"id":"627","sec":63361},{"id":"570","sec":63397},{"id":"576","sec":63413},{"id":"574","sec":63443},{"id":"579","sec":63480},{"id":"131","sec":63639},{"id":"129","sec":63721},{"id":"118","sec":63764},{"id":"475","sec":63864},{"id":"472","sec":63908},{"id":"728","sec":64080}],"2461":[{"id":"728","sec":64440},{"id":"116","sec":64494},{"id":"127","sec":64531},{"id":"128","sec":64559},{"id":"727","sec":64615},{"id":"726","sec":64687},{"id":"580","sec":64860},{"id":"575","sec":64893},{"id":"577","sec":64921},{"id":"689","sec":64939},{"id":"630","sec":64958},{"id":"631","sec":64987},{"id":"632","sec":65030},{"id":"595","sec":65077},{"id":"454","sec":65124},{"id":"452","sec":65153},{"id":"451","sec":65191},{"id":"732","sec":65756},{"id":"414","sec":65830},{"id":"462","sec":65880}],"2462":[{"id":"462","sec":66000},{"id":"413","sec":66058},{"id":"731","sec":66144},{"id":"461","sec":66777},{"id":"453","sec":66828},{"id":"604","sec":66866},{"id":"625","sec":66913},{"id":"626","sec":66955},{"id":"627","sec":67021},{"id":"570","sec":67057},{"id":"576","sec":67073},{"id":"574","sec":67103},{"id":"579","sec":67140},{"id":"131","sec":67299},{"id":"129","sec":67381},{"id":"118","sec":67424},{"id":"475","sec":67524},{"id":"472","sec":67568},{"id":"728","sec":67740}],"2463":[{"id":"728","sec":22860},{"id":"116","sec":22914},{"id":"127","sec":22951},{"id":"128","sec":22979},{"id":"727","sec":23035},{"id":"726","sec":23107},{"id":"580","sec":23280},{"id":"575","sec":23313},{"id":"577","sec":23341},{"id":"689","sec":23359},{"id":"630","sec":23378},{"id":"631","sec":23407},{"id":"632","sec":23450},{"id":"595","sec":23497},{"id":"454","sec":23544},{"id":"452","sec":23573},{"id":"451","sec":23611},{"id":"732","sec":24176},{"id":"414","sec":24250},{"id":"462","sec":24300}],"2464":[{"id":"462","sec":24480},{"id":"413","sec":24538},{"id":"731","sec":24624},{"id":"461","sec":25257},{"id":"453","sec":25308},{"id":"604","sec":25346},{"id":"625","sec":25393},{"id":"626","sec":25435},{"id":"627","sec":25501},{"id":"570","sec":25537},{"id":"576","sec":25553},{"id":"574","sec":25583},{"id":"579","sec":25620},{"id":"131","sec":25763},{"id":"129","sec":25837},{"id":"118","sec":25876},{"id":"475","sec":25966},{"id":"472","sec":26005},{"id":"728","sec":26160}],"2465":[{"id":"728","sec":26460},{"id":"116","sec":26514},{"id":"127","sec":26551},{"id":"128","sec":26579},{"id":"727","sec":26635},{"id":"726","sec":26707},{"id":"580","sec":26880},{"id":"575","sec":26917},{"id":"577","sec":26948},{"id":"689","sec":26969},{"id":"630","sec":26989},{"id":"631","sec":27022},{"id":"632","sec":27070},{"id":"595","sec":27123},{"id":"454","sec":27175},{"id":"452","sec":27208},{"id":"451","sec":27250},{"id":"732","sec":27881},{"id":"414","sec":27964},{"id":"462","sec":28020}],"2466":[{"id":"462","sec":28200},{"id":"413","sec":28258},{"id":"731","sec":28344},{"id":"461","sec":28977},{"id":"453","sec":29028},{"id":"604","sec":29066},{"id":"625","sec":29113},{"id":"626","sec":29155},{"id":"627","sec":29221},{"id":"570","sec":29257},{"id":"576","sec":29273},{"id":"574","sec":29303},{"id":"579","sec":29340},{"id":"131","sec":29483},{"id":"129","sec":29557},{"id":"118","sec":29596},{"id":"475","sec":29686},{"id":"472","sec":29725},{"id":"728","sec":29880}],"2467":[{"id":"728","sec":30300},{"id":"116","sec":30354},{"id":"127","sec":30391},{"id":"128","sec":30419},{"id":"727","sec":30475},{"id":"726","sec":30547},{"id":"580","sec":30720},{"id":"575","sec":30753},{"id":"577","sec":30781},{"id":"689","sec":30799},{"id":"630","sec":30818},{"id":"631","sec":30847},{"id":"632","sec":30890},{"id":"595","sec":30937},{"id":"454","sec":30984},{"id":"452","sec":31013},{"id":"451","sec":31051},{"id":"732","sec":31616},{"id":"414","sec":31690},{"id":"462","sec":31740}],"2468":[{"id":"462","sec":31920},{"id":"413","sec":31978},{"id":"731","sec":32064},{"id":"461","sec":32697},{"id":"453","sec":32748},{"id":"604","sec":32786},{"id":"625","sec":32833},{"id":"626","sec":32875},{"id":"627","sec":32941},{"id":"570","sec":32977},{"id":"576","sec":32993},{"id":"574","sec":33023},{"id":"579","sec":33060},{"id":"131","sec":33203},{"id":"129","sec":33277},{"id":"118","sec":33316},{"id":"475","sec":33406},{"id":"472","sec":33445},{"id":"728","sec":33600}],"2469":[{"id":"728","sec":55080},{"id":"116","sec":55134},{"id":"127","sec":55171},{"id":"128","sec":55199},{"id":"727","sec":55255},{"id":"726","sec":55327},{"id":"580","sec":55500},{"id":"575","sec":55533},{"id":"577","sec":55561},{"id":"689","sec":55579},{"id":"630","sec":55598},{"id":"631","sec":55627},{"id":"632","sec":55670},{"id":"595","sec":55717},{"id":"454","sec":55764},{"id":"452","sec":55793},{"id":"451","sec":55831},{"id":"732","sec":56396},{"id":"414","sec":56470},{"id":"462","sec":56520}],"2470":[{"id":"462","sec":56700},{"id":"413","sec":56758},{"id":"731","sec":56844},{"id":"461","sec":57477},{"id":"453","sec":57528},{"id":"604","sec":57566},{"id":"625","sec":57613},{"id":"626","sec":57655},{"id":"627","sec":57721},{"id":"570","sec":57757},{"id":"576","sec":57773},{"id":"574","sec":57803},{"id":"579","sec":57840},{"id":"131","sec":57999},{"id":"129","sec":58081},{"id":"118","sec":58124},{"id":"475","sec":58224},{"id":"472","sec":58268},{"id":"728","sec":58440}],"2471":[{"id":"728","sec":58800},{"id":"116","sec":58854},{"id":"127","sec":58891},{"id":"128","sec":58919},{"id":"727","sec":58975},{"id":"726","sec":59047},{"id":"580","sec":59220},{"id":"575","sec":59253},{"id":"577","sec":59281},{"id":"689","sec":59299},{"id":"630","sec":59318},{"id":"631","sec":59347},{"id":"632","sec":59390},{"id":"595","sec":59437},{"id":"454","sec":59484},{"id":"452","sec":59513},{"id":"451","sec":59551},{"id":"732","sec":60116},{"id":"414","sec":60190},{"id":"462","sec":60240}],"2472":[{"id":"462","sec":60420},{"id":"413","sec":60478},{"id":"731","sec":60564},{"id":"461","sec":61197},{"id":"453","sec":61248},{"id":"604","sec":61286},{"id":"625","sec":61333},{"id":"626","sec":61375},{"id":"627","sec":61441},{"id":"570","sec":61477},{"id":"576","sec":61493},{"id":"574","sec":61523},{"id":"579","sec":61560},{"id":"131","sec":61719},{"id":"129","sec":61801},{"id":"118","sec":61844},{"id":"475","sec":61944},{"id":"472","sec":61988},{"id":"728","sec":62160}],"2473":[{"id":"728","sec":62520},{"id":"116","sec":62574},{"id":"127","sec":62611},{"id":"128","sec":62639},{"id":"727","sec":62695},{"id":"726","sec":62767},{"id":"580","sec":62940},{"id":"575","sec":62973},{"id":"577","sec":63001},{"id":"689","sec":63019},{"id":"630","sec":63038},{"id":"631","sec":63067},{"id":"632","sec":63110},{"id":"595","sec":63157},{"id":"454","sec":63204},{"id":"452","sec":63233},{"id":"451","sec":63271},{"id":"732","sec":63836},{"id":"414","sec":63910},{"id":"462","sec":63960}],"2474":[{"id":"462","sec":64140},{"id":"413","sec":64198},{"id":"731","sec":64284},{"id":"461","sec":64917},{"id":"453","sec":64968},{"id":"604","sec":65006},{"id":"625","sec":65053},{"id":"626","sec":65095},{"id":"627","sec":65161},{"id":"570","sec":65197},{"id":"576","sec":65213},{"id":"574","sec":65243},{"id":"579","sec":65280},{"id":"131","sec":65439},{"id":"129","sec":65521},{"id":"118","sec":65564},{"id":"475","sec":65664},{"id":"472","sec":65708},{"id":"728","sec":65880}],"2475":[{"id":"728","sec":66240},{"id":"116","sec":66294},{"id":"127","sec":66331},{"id":"128","sec":66359},{"id":"727","sec":66415},{"id":"726","sec":66487},{"id":"580","sec":66660},{"id":"575","sec":66693},{"id":"577","sec":66721},{"id":"689","sec":66739},{"id":"630","sec":66758},{"id":"631","sec":66787},{"id":"632","sec":66830},{"id":"595","sec":66877},{"id":"454","sec":66924},{"id":"452","sec":66953},{"id":"451","sec":66991},{"id":"732","sec":67556},{"id":"414","sec":67630},{"id":"462","sec":67680}],"2476":[{"id":"462","sec":67800},{"id":"413","sec":67858},{"id":"731","sec":67944},{"id":"461","sec":68577},{"id":"453","sec":68628},{"id":"604","sec":68666},{"id":"625","sec":68713},{"id":"626","sec":68755},{"id":"627","sec":68821},{"id":"570","sec":68857},{"id":"576","sec":68873},{"id":"574","sec":68903},{"id":"579","sec":68940},{"id":"131","sec":69083},{"id":"129","sec":69157},{"id":"118","sec":69196},{"id":"475","sec":69286},{"id":"472","sec":69325},{"id":"728","sec":69480}]},
  // to-jpl = northbound toward the lab; from-jpl = southbound toward Caltech.
  stops: [
  {
    "id": "728",
    "code": "5793",
    "name": "Wilson Ave & Del Mar Blvd",
    "dir": "to-jpl"
  },
  {
    "id": "116",
    "code": "1384",
    "name": "Del Mar Blvd & Mentor Ave",
    "dir": "to-jpl"
  },
  {
    "id": "127",
    "code": "1383",
    "name": "Del Mar Blvd & Lake Ave",
    "dir": "to-jpl"
  },
  {
    "id": "128",
    "code": "1381",
    "name": "Del Mar Blvd & Hudson Ave",
    "dir": "to-jpl"
  },
  {
    "id": "727",
    "code": "1378",
    "name": "Del Mar Blvd & El Molino Ave",
    "dir": "to-jpl"
  },
  {
    "id": "726",
    "code": "3509",
    "name": "Del Mar Blvd & Los Robles Ave",
    "dir": "to-jpl"
  },
  {
    "id": "580",
    "code": "4673",
    "name": "Raymond Ave & Del Mar Blvd",
    "dir": "to-jpl"
  },
  {
    "id": "575",
    "code": "9800",
    "name": "Raymond Ave & Green St",
    "dir": "to-jpl"
  },
  {
    "id": "577",
    "code": "9809",
    "name": "Raymond Ave & Union St",
    "dir": "to-jpl"
  },
  {
    "id": "689",
    "code": "9811",
    "name": "Raymond Ave & Holly St",
    "dir": "to-jpl"
  },
  {
    "id": "630",
    "code": "1709",
    "name": "Walnut St & Raymond Ave",
    "dir": "to-jpl"
  },
  {
    "id": "631",
    "code": "3464",
    "name": "Fair Oaks Ave & Corson St",
    "dir": "to-jpl"
  },
  {
    "id": "632",
    "code": "3466",
    "name": "Fair Oaks Ave & Villa St",
    "dir": "to-jpl"
  },
  {
    "id": "595",
    "code": "3470",
    "name": "Fair Oaks Ave & Orange Grove Blvd",
    "dir": "to-jpl"
  },
  {
    "id": "454",
    "code": "5161",
    "name": "Mountain St & Fair Oaks Ave",
    "dir": "to-jpl"
  },
  {
    "id": "452",
    "code": "5168",
    "name": "Mountain St & Sunset Ave",
    "dir": "to-jpl"
  },
  {
    "id": "451",
    "code": "322",
    "name": "City of Pasadena Maintenance Yards",
    "dir": "to-jpl"
  },
  {
    "id": "732",
    "code": "3514",
    "name": "Foothill Blvd & Crown Ave",
    "dir": "to-jpl"
  },
  {
    "id": "414",
    "code": "12574",
    "name": "Oak Grove Dr & Foothill Blvd",
    "dir": "to-jpl"
  },
  {
    "id": "462",
    "code": "2707",
    "name": "JPL",
    "dir": "both"
  },
  {
    "id": "413",
    "code": "4084",
    "name": "Oak Grove Dr & Foothill Blvd",
    "dir": "from-jpl"
  },
  {
    "id": "731",
    "code": "3489",
    "name": "Foothill Blvd & Crown Ave",
    "dir": "from-jpl"
  },
  {
    "id": "461",
    "code": "309",
    "name": "Mountain St & I-210",
    "dir": "from-jpl"
  },
  {
    "id": "453",
    "code": "5173",
    "name": "Mountain St & Sunset Ave",
    "dir": "from-jpl"
  },
  {
    "id": "604",
    "code": "11972",
    "name": "Fair Oaks Ave & Mountain St",
    "dir": "from-jpl"
  },
  {
    "id": "625",
    "code": "11962",
    "name": "Fair Oaks Ave & Orange Grove Blvd",
    "dir": "from-jpl"
  },
  {
    "id": "626",
    "code": "11958",
    "name": "Fair Oaks Ave & Villa St",
    "dir": "from-jpl"
  },
  {
    "id": "627",
    "code": "10261",
    "name": "Walnut St & Fair Oaks Ave",
    "dir": "from-jpl"
  },
  {
    "id": "570",
    "code": "9946",
    "name": "Raymond Ave & Holly St",
    "dir": "from-jpl"
  },
  {
    "id": "576",
    "code": "2439",
    "name": "Raymond Ave & Union St",
    "dir": "from-jpl"
  },
  {
    "id": "574",
    "code": "3490",
    "name": "Raymond Ave & Green St",
    "dir": "from-jpl"
  },
  {
    "id": "579",
    "code": "501",
    "name": "Raymond Ave & Del Mar Blvd",
    "dir": "from-jpl"
  },
  {
    "id": "131",
    "code": "13695",
    "name": "Del Mar Blvd & Los Robles Ave",
    "dir": "from-jpl"
  },
  {
    "id": "129",
    "code": "9905",
    "name": "Del Mar Blvd & El Molino Ave",
    "dir": "from-jpl"
  },
  {
    "id": "118",
    "code": "9907",
    "name": "Del Mar Blvd & Hudson Ave",
    "dir": "from-jpl"
  },
  {
    "id": "475",
    "code": "13681",
    "name": "Lake Ave & San Pasqual St",
    "dir": "from-jpl"
  },
  {
    "id": "472",
    "code": "9049",
    "name": "California Blvd & Lake Ave",
    "dir": "from-jpl"
  }
],
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // Manual zip → KV. Same work the weekday cron does.
    if (url.searchParams.get("refresh") === "1") {
      try {
        const sched = await refreshGtfs(env);
        return json({
          ok: true,
          feed_version: sched.feed_version,
          trips: Object.keys(sched.tripToRoute).length,
          stops: sched.stops.length,
          tripStopTimes: Object.keys(sched.tripStopTimes || {}).length,
          source: sched.source,
        });
      } catch (err) {
        return json({ error: String(err?.message || err) }, 500);
      }
    }

    const sched = await loadSchedule(env);
    const index = indexStops(sched.stops);

    if (url.searchParams.get("stops") === "1" || url.pathname === "/stops") {
      return json({
        route: ROUTE,
        feed_version: sched.feed_version,
        source: sched.source,
        stops: sched.stops,
      });
    }

    const stopParam = url.searchParams.get("stop");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const fromStop = resolveStop(fromParam, index);
    const toStop = resolveStop(toParam, index);
    const oneStop = resolveStop(stopParam, index);

    if (fromParam && !fromStop) return json({ error: `unknown from=${fromParam}` }, 400);
    if (toParam && !toStop) return json({ error: `unknown to=${toParam}` }, 400);
    if (stopParam && !oneStop) return json({ error: `unknown stop=${stopParam}` }, 400);
    if (!oneStop && !(fromStop && toStop)) {
      return json({
        error: "need ?stop=CODE or ?from=CODE&to=CODE",
        hint: "GET /?stops=1 for the stop list",
      }, 400);
    }

    try {
      // 15s edge cache — the agency feed does not update faster than that.
      const res = await fetch(GTFS_RT_URL, {
        cf: { cacheTtl: 15, cacheEverything: true },
      });
      if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

      const feed = decodeFeedMessage(new Uint8Array(await res.arrayBuffer()));
      const now = Math.floor(Date.now() / 1000); // unix seconds

      const trips = [];
      for (const entity of feed.entity) {
        const tu = entity.tripUpdate;
        if (!tu) continue;
        const tripId = tu.trip?.tripId || "";
        // Prefer our static map; route_id in the protobuf is often blank.
        const route = sched.tripToRoute[tripId] || tu.trip?.routeId || "";
        if (route !== ROUTE) continue;

        // One predicted time per remaining stop on this vehicle.
        // Agency often only publishes the next 1–2 stops, so we estimate
        // missing ones from static schedule offsets when needed.
        const byStop = new Map();
        for (const stu of tu.stopTimeUpdate || []) {
          if (!stu.stopId) continue;
          const t = stu.arrival?.time || stu.departure?.time;
          if (!t) continue;
          byStop.set(stu.stopId, t);
        }

        if (fromStop && toStop) {
          const est = estimatePair(tripId, sched, byStop, fromStop, toStop, now);
          if (!est) continue;
          const departed = est.depart < now - 60;
          trips.push(makeTrip(tripId, sched, {
            from: timeBlock(fromStop, est.depart, now),
            to: timeBlock(toStop, est.arrive, now),
            ...(est.estimated ? { estimated: true } : {}),
            ...(departed ? { enroute: true } : {}),
          }));
        } else {
          const t = estimateStop(tripId, sched, byStop, oneStop, now);
          if (t == null) continue;
          trips.push(makeTrip(tripId, sched, {
            stop: timeBlock(oneStop, t.epoch, now),
            ...(t.estimated ? { estimated: true } : {}),
          }));
        }
      }

      // Sort by the time that matters: destination for from-to, else the stop.
      trips.sort((a, b) => {
        const ta = a.to?.epoch || a.from?.epoch || a.stop?.epoch;
        const tb = b.to?.epoch || b.from?.epoch || b.stop?.epoch;
        return ta - tb;
      });

      const body = {
        route: ROUTE,
        feed_version: sched.feed_version,
        updated: formatPT(now),
        updated_epoch: now,
        trips,
      };
      if (fromStop && toStop) {
        body.from = publicStop(fromStop);
        body.to = publicStop(toStop);
      } else {
        body.stop = publicStop(oneStop);
      }
      return json(body, 200, { "Cache-Control": "public, max-age=20" });
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500);
    }
  },

  // Cron entry point — wrangler.toml [triggers] crons.
  async scheduled(_event, env) {
    await refreshGtfs(env);
  },
};

// ---------------------------------------------------------------------------
// Schedule: KV first, baked-in snapshot second
// ---------------------------------------------------------------------------

async function loadSchedule(env) {
  try {
    const raw = await env.JPL_KV.get(KV_KEY, { type: "json" });
    if (raw?.tripToRoute && raw?.stops?.length) {
      return { ...raw, source: "kv" };
    }
  } catch (_) {
    // Binding missing or KV empty — use FALLBACK.
  }
  return { ...FALLBACK, source: "fallback" };
}

// Download gtfs.zip, keep only route 53, store JSON in KV.
async function refreshGtfs(env) {
  const res = await fetch(GTFS_ZIP_URL);
  if (!res.ok) throw new Error(`gtfs zip ${res.status}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const files = await unzipNamed(zip, [
    "trips.txt",
    "stops.txt",
    "stop_times.txt",
    "feed_info.txt",
  ]);

  const feedInfo = parseCsv(decodeText(files["feed_info.txt"]));
  const feed_version = feedInfo[0]?.feed_version || "unknown";

  const tripToRoute = {};
  const tripHeadsign = {};
  const tripDir = {};
  for (const row of parseCsv(decodeText(files["trips.txt"]))) {
    if (row.route_id !== ROUTE) continue;
    tripToRoute[row.trip_id] = ROUTE;
    tripHeadsign[row.trip_id] = row.trip_headsign || "";
    tripDir[row.trip_id] = dirFromTrip(row);
  }

  const stopMeta = {};
  for (const row of parseCsv(decodeText(files["stops.txt"]))) {
    stopMeta[row.stop_id] = {
      id: row.stop_id,
      code: row.stop_code || row.stop_id,
      name: row.stop_name || row.stop_id,
    };
  }

  // stop_times is the big file — skip anything that is not a 53 trip.
  // Keep both sequence (for stop catalog) and seconds-past-midnight (for
  // estimating arrivals when realtime only has a couple of near stops).
  const seqByTrip = {};
  const tripStopTimes = {};
  const wanted = new Set(Object.keys(tripToRoute));
  for (const row of parseCsv(decodeText(files["stop_times.txt"]))) {
    if (!wanted.has(row.trip_id)) continue;
    const seq = Number(row.stop_sequence);
    const stop_id = row.stop_id;
    (seqByTrip[row.trip_id] ||= []).push({ seq, stop_id });
    const parts = (row.arrival_time || "0:0:0").split(":");
    const sec =
      Number(parts[0] || 0) * 3600 +
      Number(parts[1] || 0) * 60 +
      Number(parts[2] || 0);
    (tripStopTimes[row.trip_id] ||= []).push({ seq, id: stop_id, sec });
  }
  for (const tid of Object.keys(tripStopTimes)) {
    tripStopTimes[tid].sort((a, b) => a.seq - b.seq);
    tripStopTimes[tid] = tripStopTimes[tid].map(({ id, sec }) => ({ id, sec }));
  }

  // One representative trip per direction (the one with the most stops).
  const best = { "to-jpl": null, "from-jpl": null };
  for (const [tid, seq] of Object.entries(seqByTrip)) {
    const dir = tripDir[tid];
    if (!best[dir] || seq.length > best[dir].seq.length) {
      best[dir] = { tid, seq };
    }
  }

  const seen = new Set();
  const stops = [];
  for (const dir of ["to-jpl", "from-jpl"]) {
    const picked = best[dir];
    if (!picked) continue;
    const ordered = picked.seq.slice().sort((a, b) => a.seq - b.seq);
    for (const s of ordered) {
      const meta = stopMeta[s.stop_id];
      if (!meta) continue;
      const isJpl =
        meta.code === "2707" ||
        meta.name === "JPL" ||
        /^jpl$/i.test(meta.name);
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      stops.push({
        id: meta.id,
        code: meta.code,
        name: meta.name,
        dir: isJpl ? "both" : dir,
      });
    }
  }

  const payload = {
    feed_version,
    refreshed_epoch: Math.floor(Date.now() / 1000),
    tripToRoute,
    tripHeadsign,
    tripStopTimes,
    stops,
  };

  if (!env.JPL_KV) {
    throw new Error("JPL_KV binding missing — create the namespace and set id in wrangler.toml");
  }
  await env.JPL_KV.put(KV_KEY, JSON.stringify(payload));
  return { ...payload, source: "refresh" };
}

function dirFromTrip(row) {
  const h = (row.trip_headsign || "").toLowerCase();
  if (h.includes("jpl")) return "to-jpl";
  if (h.includes("caltech")) return "from-jpl";
  return row.direction_id === "1" ? "to-jpl" : "from-jpl";
}

function indexStops(stops) {
  const byId = new Map();
  const byCode = new Map();
  for (const s of stops) {
    if (!byId.has(s.id)) byId.set(s.id, s);
    if (!byCode.has(s.code)) byCode.set(s.code, s);
  }
  return { byId, byCode };
}

function resolveStop(raw, index) {
  if (!raw) return null;
  const key = String(raw).trim();
  return index.byCode.get(key) || index.byId.get(key) || null;
}

function publicStop(s) {
  return { id: s.id, code: s.code, name: s.name, dir: s.dir };
}

/**
 * Estimate absolute arrival/departure at from+to using any predicted stop on
 * the same trip. Relative offsets come from static GTFS stop_times (seconds
 * past midnight). When the agency only publishes the next stop or two, this
 * still yields usable times for intermediate and downstream stops.
 *
 * Returns null if the trip does not serve the pair in order, has no usable
 * prediction, or the destination is already in the past. Origin may be past
 * (bus already left the board stop) — we still return the trip so a rider
 * can keep watching the arrival prediction after boarding.
 */
function estimatePair(tripId, sched, byStop, fromStop, toStop, now) {
  const seq = sched.tripStopTimes?.[tripId];
  if (!seq?.length) {
    // Old KV / no schedule offsets: require both stops present in the feed.
    const depart = byStop.get(fromStop.id);
    const arrive = byStop.get(toStop.id);
    if (depart == null || arrive == null) return null;
    if (arrive < depart) return null;
    if (arrive < now - 60) return null; // destination already past
    return { depart, arrive, estimated: false };
  }

  const fromIdx = seq.findIndex((s) => s.id === fromStop.id);
  const toIdx = seq.findIndex((s) => s.id === toStop.id);
  if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) return null;

  // Prefer the predicted stop closest in sequence to the board stop.
  // Once the bus is past `from`, later predictions still give a consistent
  // delay that we can apply to the destination.
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < seq.length; i++) {
    const pred = byStop.get(seq[i].id);
    if (pred == null) continue;
    const dist = Math.abs(i - fromIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = { pred, sec: seq[i].sec };
    }
  }
  if (!best) return null;

  const depart = best.pred + (seq[fromIdx].sec - best.sec);
  const arrive = best.pred + (seq[toIdx].sec - best.sec);
  if (arrive < now - 60) return null; // already past the destination
  return {
    depart,
    arrive,
    estimated: bestDist !== 0 || !byStop.has(toStop.id),
  };
}

/** Same idea for a single-stop query. */
function estimateStop(tripId, sched, byStop, stop, now) {
  const exact = byStop.get(stop.id);
  if (exact != null) {
    if (exact < now - 60) return null;
    return { epoch: exact, estimated: false };
  }

  const seq = sched.tripStopTimes?.[tripId];
  if (!seq?.length) return null;

  const targetIdx = seq.findIndex((s) => s.id === stop.id);
  if (targetIdx < 0) return null;

  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < seq.length; i++) {
    const pred = byStop.get(seq[i].id);
    if (pred == null) continue;
    const dist = Math.abs(i - targetIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = { pred, sec: seq[i].sec };
    }
  }
  if (!best) return null;

  const epoch = best.pred + (seq[targetIdx].sec - best.sec);
  if (epoch < now - 60) return null;
  return { epoch, estimated: true };
}

function timeBlock(stop, epoch, now) {
  const minutes = (epoch - now) / 60;
  return {
    ...publicStop(stop),
    minutes: Math.max(0, Math.round(minutes)),
    minutes_raw: Number(minutes.toFixed(1)),
    time: formatPT(epoch),
    epoch,
  };
}

function makeTrip(tripId, sched, extra) {
  return {
    route: ROUTE,
    trip_id: tripId,
    headsign: sched.tripHeadsign[tripId] || null,
    ...extra,
  };
}

function formatPT(epochSec) {
  return new Date(epochSec * 1000).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extra,
    },
  });
}

// ---------------------------------------------------------------------------
// Tiny CSV / zip helpers (no npm — Workers have DecompressionStream)
// ---------------------------------------------------------------------------

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Walk the zip central directory and inflate only the names we need.
async function unzipNamed(bytes, names) {
  const want = new Set(names);
  const found = {};
  const eocd = findEOCD(bytes);
  const cdOff = u32(bytes, eocd + 16);
  const cdEntries = u16(bytes, eocd + 10);
  let p = cdOff;
  for (let n = 0; n < cdEntries; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("bad zip central dir");
    const method = u16(bytes, p + 10);
    const comp = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const name = decodeText(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split("/").pop();
    if (!want.has(base) && !want.has(name)) continue;
    found[base] = await readZipFile(bytes, localOff, method, comp);
  }
  for (const n of names) {
    if (!found[n]) throw new Error(`zip missing ${n}`);
  }
  return found;
}

// End-of-central-directory record sits in the last 64K of the zip.
function findEOCD(bytes) {
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) return i;
  }
  throw new Error("zip EOCD not found");
}

async function readZipFile(bytes, localOff, method, comp) {
  if (u32(bytes, localOff) !== 0x04034b50) throw new Error("bad local header");
  const nameLen = u16(bytes, localOff + 26);
  const extraLen = u16(bytes, localOff + 28);
  const start = localOff + 30 + nameLen + extraLen;
  const slice = bytes.subarray(start, start + comp);
  if (method === 0) return slice; // stored uncompressed
  if (method !== 8) throw new Error(`zip method ${method}`);
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([slice]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u16(b, i) {
  return b[i] | (b[i + 1] << 8);
}
function u32(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

// ---------------------------------------------------------------------------
// GTFS-RT protobuf — only the fields we actually read
//
// FeedMessage.entity           = 2
//   FeedEntity.trip_update     = 3
//     TripUpdate.trip          = 1   (TripDescriptor)
//       trip_id                = 1
//       route_id               = 5
//     TripUpdate.stop_time_update = 2
//       arrival                = 2   (StopTimeEvent)
//       departure              = 3
//       stop_id                = 4
//         StopTimeEvent.time   = 2   (posix seconds)
//
// Wire types: 0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit.
// ---------------------------------------------------------------------------

function decodeFeedMessage(bytes) {
  const r = new Reader(bytes);
  const out = { entity: [] };
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) out.entity.push(decodeEntity(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function decodeEntity(bytes) {
  const r = new Reader(bytes);
  const out = {};
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 3 && wire === 2) out.tripUpdate = decodeTripUpdate(r.bytes());
    else r.skip(wire);
  }
  return out;
}

function decodeTripUpdate(bytes) {
  const r = new Reader(bytes);
  const out = { stopTimeUpdate: [] };
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) out.trip = decodeTripDescriptor(r.bytes());
    else if (field === 2 && wire === 2) out.stopTimeUpdate.push(decodeStopTimeUpdate(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function decodeTripDescriptor(bytes) {
  const r = new Reader(bytes);
  const out = {};
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) out.tripId = r.string();
    else if (field === 5 && wire === 2) out.routeId = r.string();
    else r.skip(wire);
  }
  return out;
}

function decodeStopTimeUpdate(bytes) {
  const r = new Reader(bytes);
  const out = {};
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) out.arrival = decodeStopTimeEvent(r.bytes());
    else if (field === 3 && wire === 2) out.departure = decodeStopTimeEvent(r.bytes());
    else if (field === 4 && wire === 2) out.stopId = r.string();
    else r.skip(wire);
  }
  return out;
}

function decodeStopTimeEvent(bytes) {
  const r = new Reader(bytes);
  const out = {};
  while (r.remaining()) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 0) out.time = r.varint();
    else r.skip(wire);
  }
  return out;
}

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.i = 0;
  }
  remaining() {
    return this.i < this.b.length;
  }
  tag() {
    const n = this.varint();
    return { field: n >>> 3, wire: n & 7 };
  }
  varint() {
    let n = 0n;
    let shift = 0n;
    while (true) {
      const byte = BigInt(this.b[this.i++]);
      n |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) break;
      shift += 7n;
    }
    return Number(n);
  }
  bytes() {
    const len = this.varint();
    const slice = this.b.subarray(this.i, this.i + len);
    this.i += len;
    return slice;
  }
  string() {
    return new TextDecoder().decode(this.bytes());
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.i += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.i += 4;
    else throw new Error(`unknown wire type ${wire}`);
  }
}
