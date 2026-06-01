// Normalized response shapes returned by our API

export interface AlbumSearchResult {
  id: string;
  title: string;
  artist: string;
  releaseDate: string;
  primaryType?: string;
  artworkUrl?: string;
  artworkSource?: string;
}

export interface AlbumEdition {
  id: string;
  title: string;
  releaseDate: string;
  country: string;
  formats: string[];
  trackCount: number;
  artworkUrl?: string;
}
