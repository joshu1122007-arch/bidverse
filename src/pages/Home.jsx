import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ShieldCheck, Zap, Sparkles, Camera, Shirt, Gem, Palette, Watch, Shapes, UserRoundPlus, Search, Gavel, Trophy, MoveUpRight } from 'lucide-react';
import { supabase, isConfigured } from '../lib/supabase';
import { sampleAuctions } from '../data/sampleAuctions';
import AuctionCard from '../components/AuctionCard';
import StatePanel from '../components/StatePanel';

const categoryIcons = [Camera, Shirt, Gem, Palette, Watch, Shapes];
const categoryNames = ['Electronics', 'Fashion', 'Collectibles', 'Art', 'Accessories', 'Other'];
const steps = [
  [UserRoundPlus, 'Create your account', 'A quick sign-up is all it takes to join the hunt.'],
  [Search, 'Find something you love', 'Explore unique pieces across your favourite categories.'],
  [Gavel, 'Make your move', 'Place a bid and follow the action as it happens.'],
  [Trophy, 'Win your next favourite', 'The highest valid bid wins when the clock runs out.'],
];

export default function Home() {
  const [auctions, setAuctions] = useState(isConfigured ? [] : sampleAuctions.slice(0, 4));
  const [loading, setLoading] = useState(isConfigured);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let inFlight = false;
    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const { data, error: queryError } = await supabase.from('auction_summaries').select('*').gt('end_time', new Date().toISOString()).order('end_time').limit(4);
        if (queryError) throw queryError;
        if (active) { setAuctions(data || []); setError(''); }
      } catch {
        if (active) setError('We couldn’t load featured auctions. Check your connection and Supabase setup.');
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { active = false; clearInterval(interval); };
  }, [retry]);

  return <>
    <section className="hero"><div className="container hero-layout"><div className="hero-copy">
      <div className="hero-kicker"><span className="kicker-dot" />A marketplace for the extraordinary</div>
      <h1>Discover rare finds.<br />Bid for what<br />you <span className="hero-love">love<svg viewBox="0 0 200 14" aria-hidden="true"><path d="M3 10Q95-3 197 7" /></svg></span><span className="gold-period">.</span></h1>
      <p>From everyday favourites to one-of-a-kind treasures.<br className="desktop-break" /> Discover something special. Make it yours.</p>
      <div className="hero-buttons"><Link to="/explore" className="button button-primary">Explore auctions <ArrowUpRight size={18} /></Link><Link to="/create" className="button button-secondary">Start selling <ArrowRight size={17} /></Link></div>
      <div className="hero-proof"><span><ShieldCheck size={17} />Secure bidding</span><span><Zap size={17} />Live updates</span><span><Gem size={17} />Unique finds</span></div>
    </div><div className="hero-visual" aria-label="A curated collection of cameras, headphones and watches">
      <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
      <div className="hero-edition"><Sparkles size={14} />THE COLLECTOR’S EDIT</div>
      <div className="hero-product"><img src="/images/camera.jpg" alt="A beautifully crafted camera" /><div className="hero-product-caption"><span>FOR THE CURIOUS</span><h2>Objects with a story.</h2><Link to="/explore?category=Electronics" aria-label="Explore electronics"><MoveUpRight size={22} /></Link></div></div>
      <div className="hero-mini"><img src="/images/headphones.jpg" alt="Premium headphones" /><div><span>A little inspiration</span><strong>Find your next favourite.</strong></div><ArrowUpRight size={19} /></div>
      <div className="hero-stamp"><Sparkles size={23} /><span>Great finds.<br /><strong>Better stories.</strong></span></div>
      <span className="hero-coordinate">CURATED BY CURIOSITY — BIDVERSE</span>
    </div></div></section>
    <div className="benefit-strip"><div className="container benefit-inner"><span><ShieldCheck size={18} />Every bid. Securely checked.</span><span><Gavel size={18} />Fair auctions. Clear outcomes.</span><span><Sparkles size={18} />Your next great discovery.</span></div></div>

    <section className="section container"><div className="section-heading"><div><span className="eyebrow"><span className="live-dot" />THE GOOD FINDS DON’T WAIT</span><h2>Worth a closer look<span className="gold-period">.</span></h2><p>Standout pieces. A little competition. Something for you.</p></div><Link to="/explore" className="text-link">View all auctions <ArrowRight size={17} /></Link></div>
      {!isConfigured && <div className="sample-notice"><span className="sample-label">PREVIEW MODE</span>These are read-only sample auctions. Connect Supabase to list products and place real bids. <Link to="/login">Setup details <ArrowUpRight size={13} /></Link></div>}
      {error && auctions.length > 0 && <div className="refresh-error" role="alert"><p>We couldn’t refresh featured auctions. Showing the last loaded listings. {error}</p><button className="button button-secondary button-sm" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {loading ? <StatePanel loading title="Loading featured auctions…" /> : error && !auctions.length ? <StatePanel title="The marketplace is a little out of reach" message={error}><button className="button button-primary" onClick={() => setRetry(retry + 1)}>Try again</button></StatePanel> : auctions.length ? <div className="auction-grid home-auction-grid">{auctions.map(auction => <AuctionCard key={auction.id} auction={auction} />)}</div> : <StatePanel title="Be the first great find" message="The marketplace is ready for its first listing."><Link to="/create" className="button button-primary">Create an auction <ArrowUpRight size={17} /></Link></StatePanel>}
    </section>

    <section className="categories-section"><div className="container"><div className="section-heading"><div><span className="eyebrow">FOLLOW YOUR CURIOSITY</span><h2>Find your kind of extraordinary.</h2></div><span className="muted category-intro">A world of possibilities.<br />Where will you start?</span></div><div className="category-grid">{categoryNames.map((category, index) => { const Icon = categoryIcons[index]; return <Link to={`/explore?category=${category}`} className="category-tile" key={category}><span className={`category-icon category-color-${index}`}><Icon size={25} strokeWidth={1.5} /></span><strong>{category}</strong><ArrowUpRight size={15} /></Link>; })}</div></div></section>

    <section className="section container how-section"><div className="section-heading centered"><span className="eyebrow">FROM FIRST LOOK TO WINNING BID</span><h2>A great find is just four steps away.</h2><p>Simple to start. Exciting to follow. Made for everyone.</p></div><div className="steps-grid">{steps.map(([Icon, title, text], index) => <div className="step" key={title}><div className="step-icon"><Icon size={25} strokeWidth={1.6} /><span>0{index + 1}</span></div><h3>{title}</h3><p>{text}</p></div>)}</div></section>
    <section className="container seller-cta"><div className="cta-pattern" /><div className="seller-cta-copy"><span className="eyebrow">SOMETHING SPECIAL DESERVES A NEW CHAPTER</span><h2>Your shelf. Someone’s treasure.</h2><p>Turn the things you no longer need into someone else’s next great find.</p><Link to="/create" className="button button-white">Create your first auction <ArrowUpRight size={17} /></Link></div><div className="cta-gavel"><Gavel size={112} strokeWidth={1} /><span>Let the bidding begin.</span></div></section>
  </>;
}
