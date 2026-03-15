/**
 * icons.tsx — Lucide React wrappers with backward-compatible `s` prop.
 * Replaces 63-line hand-drawn SVG file with 1,400+ professional icons.
 *
 * Usage unchanged: import { I } from './icons'; then <I.Hash s={18} />
 */
import {
  Hash as LHash, Lock as LLock, Send as LSend, Plus as LPlus,
  Users as LUsers, Menu as LMenu, X as LX, Copy as LCopy,
  Settings as LSettings, Home as LHome, MessageCircle as LMsg,
  Search as LSearch, Trash2 as LTrash, LogOut as LOut, Pencil as LEdit,
  Mic as LMic, MicOff as LMicOff, Smile as LSmile, Paperclip as LPaperclip,
  Shield as LShield, Clock as LClock, Bot as LBot, Reply as LReply,
  SlidersHorizontal as LSliders, AtSign as LAt, Bell as LBell,
  BellOff as LBellOff, Pin as LPin, Check as LCheck, Volume2 as LVol,
  Camera as LCamera, Monitor as LMonitor, Headphones as LHeadphones,
  PhoneOff as LPhoneOff, UserPlus as LUserPlus, Download as LDownload,
  Link as LLink, Globe as LGlobe, Zap as LZap, Eye as LEye,
  EyeOff as LEyeOff, ChevronDown as LChevD, ChevronRight as LChevR,
  Star as LStar,
  ShieldCheck as LShieldCheck, ShieldAlert as LShieldAlert,
  Bug as LBug,
  Bookmark as LBookmark,
} from 'lucide-react';

// Backward-compatible wrapper: accepts `s` (size) prop
const w = (Icon: any, defaultSize = 14) =>
  ({ s = defaultSize }: { s?: number }) =>
    <Icon size={s} strokeWidth={2} />;

// Individual exports (same names as before)
export const Hash = w(LHash);
export const Lock = w(LLock);
export const Send = w(LSend);
export const Plus = w(LPlus);
export const Users = w(LUsers);
export const Menu = w(LMenu);
export const X = w(LX);
export const Copy = w(LCopy);
export const Settings = w(LSettings);
export const Home = w(LHome);
export const Msg = w(LMsg);
export const Search = w(LSearch);
export const Trash = w(LTrash);
export const Out = w(LOut);
export const Edit = w(LEdit);
export const Mic = w(LMic);
export const MicOff = w(LMicOff);
export const Smile = w(LSmile);
export const Paperclip = w(LPaperclip, 16);
export const Shield = w(LShield);
export const Clock = w(LClock);
export const Bot = w(LBot);
export const Reply = w(LReply);
export const Sliders = w(LSliders);
export const At = w(LAt);
export const Bell = w(LBell);
export const BellOff = w(LBellOff);
export const Pin = w(LPin);
export const Check = w(LCheck);
export const Vol = w(LVol);
export const Camera = w(LCamera);
export const Monitor = w(LMonitor);
export const Headphones = w(LHeadphones);
export const PhoneOff = w(LPhoneOff);
export const UserPlus = w(LUserPlus);
export const Download = w(LDownload);
export const Link = w(LLink);
export const Globe = w(LGlobe);
export const Zap = w(LZap);
export const Eye = w(LEye);
export const EyeOff = w(LEyeOff);
export const ChevD = w(LChevD);
export const ChevR = w(LChevR);
export const Star = w(LStar);
export const ShieldCheck = w(LShieldCheck);
export const ShieldAlert = w(LShieldAlert);
export const BugIcon = w(LBug);
export const Bookmark = w(LBookmark);

// Bundle export (same as before — import { I } from './icons')
export const I = {
  Hash, Lock, Send, Plus, Users, Menu, X, Copy, Settings,
  Home, Msg, Search, Trash, Out, Edit, Mic, MicOff, Smile, Paperclip,
  Shield, Clock, Download, Eye, EyeOff, Zap, Bot, Reply, Sliders, At, Bell, BellOff,
  Pin, Check, Vol, Camera, Monitor, Headphones, PhoneOff, UserPlus,
  Link, Globe, ChevD, ChevR, Star, ShieldCheck, ShieldAlert, BugIcon, Bookmark,
};
