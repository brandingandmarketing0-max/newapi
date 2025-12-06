
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mhtftjpddyottiifioku.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  // Check if we're on Railway (Railway sets PORT automatically)
  const isRailway = process.env.PORT && process.env.NODE_ENV === 'production';
  const envSource = isRailway ? "Railway dashboard (Variables tab)" : ".env file";
  
  console.error(`❌ SUPABASE_KEY is missing!`);
  console.error(`   Set SUPABASE_KEY or SUPABASE_ANON_KEY in ${envSource}`);
  
  if (isRailway) {
    console.error(`   📍 On Railway: Go to your service → Variables tab → Add SUPABASE_KEY`);
    console.error(`   📍 Also add SUPABASE_URL if not already set`);
    // Don't exit on Railway - let it show in logs and Railway will handle restart
    throw new Error("SUPABASE_KEY environment variable is required. Set it in Railway dashboard → Variables tab");
  } else {
    console.error(`   📍 For local dev: Create .env file with SUPABASE_KEY`);
    process.exit(1);
  }
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

