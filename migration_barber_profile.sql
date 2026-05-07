-- migration_barber_profile.sql
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS specialty VARCHAR(120);
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS photo_url TEXT;

UPDATE barbers b
SET specialty = CASE u.full_name
  WHEN 'Carlos Tatu' THEN 'Degrade, barba desenhada'
  WHEN 'Felipe Barcks' THEN 'Corte classico, navalhado'
  ELSE COALESCE(specialty, 'Corte moderno e acabamento premium')
END,
photo_url = CASE u.full_name
  WHEN 'Carlos Tatu' THEN 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=400&q=80'
  WHEN 'Felipe Barcks' THEN 'https://images.unsplash.com/photo-1622287162716-f311baa1a2b8?auto=format&fit=crop&w=400&q=80'
  ELSE COALESCE(photo_url, 'https://images.unsplash.com/photo-1503951458645-643d53bfd90f?auto=format&fit=crop&w=400&q=80')
END
FROM users u
WHERE u.id = b.user_id;
