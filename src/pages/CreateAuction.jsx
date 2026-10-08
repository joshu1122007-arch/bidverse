import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ImagePlus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';
import { categories } from '../lib/format';

export default function CreateAuction() {
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [endTime, setEndTime] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const selectImage = (event) => {
    const selected = event.target.files?.[0];
    setError('');
    if (!selected) { setImage(null); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || !selected.size || selected.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG, or WebP image up to 5 MB.');
      setImage(null);
      event.target.value = '';
      return;
    }
    setImage(selected);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !supabase || !user) return;
    setError('');
    const amount = Number(price);
    const deadline = new Date(endTime);
    if (title.trim().length < 3 || title.trim().length > 100 || description.trim().length < 10 || description.trim().length > 5000) {
      setError('Use 3–100 characters for the title and 10–5,000 characters for the description.'); return;
    }
    if (!categories.includes(category)) { setError('Choose a category for your item.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
      setError('Enter a starting price above ₹0 and up to ₹1,000,000,000 with at most two decimal places.'); return;
    }
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) { setError('Choose an end date and time in the future.'); return; }
    if (!image) { setError('Add a photo of the item before publishing.'); return; }
    setBusy(true);
    let uploadedPath = null;
    let safeToRemove = true;
    try {
      try {
        const photo = await createImageBitmap(image);
        photo.close();
      } catch { throw new Error('Choose a valid JPG, PNG, or WebP photo. This file could not be opened.'); }
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.type];
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('auction-images').upload(path, image, { contentType: image.type, cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      uploadedPath = path;
      const { data: imageData } = supabase.storage.from('auction-images').getPublicUrl(path);
      if (!imageData?.publicUrl) throw new Error('The uploaded image URL could not be created. Please try again.');
      safeToRemove = false;
      const { data, error: insertError } = await supabase.from('auctions').insert({
        seller_id: user.id, title: title.trim(), description: description.trim(), category,
        starting_price: amount, end_time: deadline.toISOString(), image_url: imageData.publicUrl,
      }).select('id').single();
      if (insertError) {
        // A lost response can hide a committed listing, so only SQL failures allow image cleanup.
        safeToRemove = /^[0-9A-Z]{5}$/.test(insertError.code ?? '');
        throw insertError;
      }
      if (!data?.id) throw new Error('We could not confirm the new listing. Check your dashboard before retrying.');
      notify('Your auction is live. Let the bidding begin!');
      navigate(`/auctions/${data.id}`, { replace: true });
    } catch (failure) {
      let message = failure.message || 'Your auction could not be published. Please try again.';
      if (uploadedPath && safeToRemove) {
        try {
          const { error: cleanupError } = await supabase.storage.from('auction-images').remove([uploadedPath]);
          if (cleanupError) message += ' The uploaded image could not be removed.';
        } catch { message += ' The uploaded image could not be removed.'; }
      } else if (uploadedPath) message += ' Check your dashboard before retrying; the listing may have been published.';
      setError(message);
    } finally { setBusy(false); }
  };

  return <div className="container page-shell">
    <div className="page-heading"><div><span className="eyebrow">GIVE SOMETHING GREAT A NEW HOME</span><h1>Create an auction<span className="accent-text">.</span></h1><p className="muted">A good photo. An honest story. Let the right buyer find you.</p></div><Link className="button button-secondary" to="/dashboard">My dashboard</Link></div>
    <div className="create-layout">
      <form className="panel create-form" onSubmit={submit} aria-busy={busy}>
        <div className="section-heading"><span className="step-number">01</span><div><h2>The details</h2><p className="muted">Tell buyers what makes your item special.</p></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-field"><label htmlFor="auction-title">Item title</label><input id="auction-title" name="title" placeholder="e.g. Vintage 35mm film camera" minLength={3} maxLength={100} required value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /><span className="field-hint">A clear, descriptive name helps the right buyer find your item.</span></div>
        <div className="form-field"><label htmlFor="auction-description">Description</label><textarea id="auction-description" name="description" rows={5} placeholder="Share the condition, story, and any details a buyer should know..." minLength={10} maxLength={5000} required value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></div>
        <div className="form-grid"><div className="form-field"><label htmlFor="auction-category">Category</label><select id="auction-category" name="category" required value={category} onChange={(event) => setCategory(event.target.value)} disabled={busy}><option value="" disabled>Select a category</option>{categories.map((name) => <option key={name}>{name}</option>)}</select></div><div className="form-field"><label htmlFor="auction-price">Starting price (₹)</label><input id="auction-price" name="starting_price" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" placeholder="0.00" required value={price} onChange={(event) => setPrice(event.target.value)} disabled={busy} /></div></div>
        <div className="form-field"><label htmlFor="auction-deadline">Auction end date &amp; time</label><input id="auction-deadline" name="end_time" type="datetime-local" required value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={busy} /><span className="field-hint">Shown in your local time. Bidding closes automatically at this time.</span></div>
        <div className="section-heading"><span className="step-number">02</span><div><h2>Make a great first impression</h2><p className="muted">Give your item a moment in the spotlight.</p></div></div>
        <div className="form-field"><label htmlFor="auction-image">Item photo</label><div className="upload-zone">{preview ? <img className="upload-preview" src={preview} alt="Preview of your auction item" /> : <><ImagePlus size={35} /><strong>A great photo makes all the difference</strong><span className="muted">Choose a JPG, PNG, or WebP image up to 5 MB.</span></>}<input id="auction-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required onChange={selectImage} disabled={busy} aria-describedby="photo-hint" /></div><span className="field-hint" id="photo-hint">Use a clear photo you own. The photo will be public.</span></div>
        <div className="form-actions"><span className="muted"><ShieldCheck size={16} /> Review your details before going live.</span><button className="button button-primary" type="submit" disabled={busy || !user || !supabase}>{busy ? 'Publishing your auction...' : 'Publish auction'}<ArrowRight size={17} /></button></div>
      </form>
      <aside className="create-tips panel"><span className="eyebrow">A LITTLE SELLER WISDOM</span><h2>Set your auction<br />up for success.</h2><p><Check size={18} /> Use natural light and a clean background for your photo.</p><p><Check size={18} /> Be honest about condition, wear, and what is included.</p><p><Check size={18} /> Start at a price you would be happy to accept.</p><p><Check size={18} /> Give buyers enough time to discover your item.</p><div className="seller-note"><ShieldCheck size={23} /><strong>Every bid counts.</strong><span>You can delete an active listing before its first bid. Listings are locked once bidding begins.</span></div></aside>
    </div>
  </div>;
}
