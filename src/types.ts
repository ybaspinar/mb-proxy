// MusicBrainz API response shapes

export interface MusicBrainzArtistCredit {
  name?: string;
}

export interface MusicBrainzReleaseGroup {
  id?: string;
  title?: string;
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
  "primary-type"?: string;
}

export interface MusicBrainzReleaseGroupResponse {
  "release-groups"?: MusicBrainzReleaseGroup[];
  count?: number;
}

export interface MusicBrainzTrack {
  title?: string;
  position?: number;
  length?: number;
}

export interface MusicBrainzMedium {
  format?: string;
  position?: number;
  "track-count"?: number;
  tracks?: MusicBrainzTrack[];
}

export interface MusicBrainzRelease {
  id?: string;
  title?: string;
  date?: string;
  country?: string;
  media?: MusicBrainzMedium[];
  "release-group"?: {
    id?: string;
    title?: string;
    "primary-type"?: string;
    "first-release-date"?: string;
  };
}

export interface MusicBrainzReleaseListResponse {
  releases?: MusicBrainzRelease[];
  count?: number;
}

export interface MusicBrainzReleaseDetailResponse {
  id?: string;
  title?: string;
  date?: string;
  media?: MusicBrainzMedium[];
  "artist-credit"?: MusicBrainzArtistCredit[];
}

// Cover Art Archive shapes

export interface CoverArtImage {
  front?: boolean;
  back?: boolean;
  image?: string;
  thumbnails?: {
    large?: string;
    small?: string;
  };
}

export interface CoverArtResponse {
  images?: CoverArtImage[];
}

// Normalized response shapes for our API

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
