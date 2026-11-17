import { router } from 'expo-router';
import PeopleScreen from '@/components/people-screen';

export default function People() {
  return <PeopleScreen onBack={() => router.back()} />;
}
