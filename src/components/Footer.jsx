import { Link } from 'react-router-dom';
import { ArrowUpRight, Heart } from 'lucide-react';
import { Brand } from './Navbar';

export default function Footer() {
  return <footer className="site-footer"><div className="container footer-top"><div className="footer-brand"><Brand light /><p>A little curiosity. A great discovery.<br />Your next favourite find is waiting.</p><span className="footer-tagline">Discover. Bid. Win.</span></div>
    <div><h3>The marketplace</h3><Link to="/explore">Explore auctions <ArrowUpRight size={13} /></Link><Link to="/create">Start selling</Link><Link to="/dashboard">Your dashboard</Link></div>
    <div><h3>Find your thing</h3><Link to="/explore?category=Electronics">Electronics</Link><Link to="/explore?category=Collectibles">Collectibles</Link><Link to="/explore?category=Art">Art & inspiration</Link></div>
    <div className="footer-note"><h3>Good finds. Fair bids.</h3><p>Every bid is checked securely.<br />Every auction has a clear finish.</p><Link to="/login">Join the community <ArrowUpRight size={14} /></Link></div>
  </div><div className="container footer-bottom"><span>© {new Date().getFullYear()} BidVerse. All rights reserved.</span><span>Made with curiosity <Heart size={12} /> Built for discovery.</span><span>Hackathon edition · No payments collected</span></div></footer>;
}
