
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mhtftjpddyottiifioku.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error("❌ SUPABASE_KEY is missing! Set SUPABASE_KEY or SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

console.log(`🔗 Connecting to Supabase: ${SUPABASE_URL}`);
console.log(`🔑 Using key: ${SUPABASE_KEY.substring(0, 20)}...`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

// Test connection on startup
(async () => {
  try {
    const { data, error } = await supabase
      .from('ig_profiles')
      .select('count', { count: 'exact', head: true });
    
    if (error && error.message.includes('Could not find the table')) {
      console.error('❌ Table ig_profiles does not exist in Supabase!');
      console.error('📝 Please run the migration SQL from supabase/migrations/20251120_init_schema.sql in your Supabase SQL Editor');
      console.error('   Error:', error.message);
    } else if (error) {
      console.error('⚠️  Supabase connection test error:', error.message);
    } else {
      console.log('✅ Supabase connected successfully! Table ig_profiles exists.');
    }
  } catch (err) {
    console.error('⚠️  Failed to test Supabase connection:', err.message);
  }
})();

module.exports = supabase;

