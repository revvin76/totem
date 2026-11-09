export const THUMBNAIL_TYPES = [
  ['front-cover','Case cover · front'], ['back-cover','Case cover · back'],
  ['3d-artwork','3D box artwork'], ['cartridge','Cartridge artwork'], ['disc','Disc artwork'],
  ['medium-back','Cartridge / disc · back'], ['logo','Game logo'], ['clear-logo','Clear logo'],
  ['screenshot','Screenshot'], ['title-screen','Title screen'], ['banner','Marquee / banner'],
  ['cabinet','Arcade cabinet'], ['bezel','Bezel'], ['vertical','Vertical artwork'],
];
export function normalizeThumbnails(design = {}) {
  const value=design.thumbnails || {};
  const valid=type=>THUMBNAIL_TYPES.some(([id])=>id===type);
  const legacy=Object.values(value).find(type=>typeof type==='string' && valid(type));
  return {
    enabled: typeof value.enabled==='boolean' ? value.enabled : Boolean(legacy),
    type: valid(value.type) ? value.type : valid(design.defaultThumbnailType) ? design.defaultThumbnailType : legacy || 'front-cover',
  };
}
