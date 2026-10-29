export interface Viewer {
  id: string;
  username: string | null;
  name: string;
  emailVerified: boolean;
  image: string | null;
  coverImage: string | null;
  bio: string;
  location?: string;
  role: string;
  suspended: boolean;
}
export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  image: string | null;
  coverImage: string | null;
  bio: string;
  location: string;
  created_at: number;
  isCaledonMember: number;
}
export interface ForumPost {
  id: string;
  publicId: string;
  authorId: string;
  rootId: string | null;
  parentId: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
  deleted: number;
  locked: number;
  name: string;
  username: string;
  image: string | null;
  isCaledonMember: boolean;
  directReplies: number;
  hasChildren: number;
  parentUsername?: string;
  parentPublicId?: string;
  shares: number;
  views: number;
  likes: number;
  replies: number;
  liked: number;
  parentName?: string;
  parentBody?: string;
}
export interface LinkPreview {
  id: string;
  url: string;
  kind: "image" | "link" | "youtube";
  title: string;
  description: string;
  site: string;
  image: string | null;
  videoId: string | null;
  checkedAt: number;
}
