package com.smhrd.myapp.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.smhrd.myapp.entity.MemberEntity;

// 일반 인터페이스가 아닌 JPA 인터페이스임을 명시
@Repository
public interface MemberRepository extends JpaRepository<MemberEntity, Long>{

	// JpaRepository<T, ID>
	// T : Entity객체 타입
	// ID : PK값의 데이터 타입
	
	// 기본적으로 제공하는 메소드
	// 1. findAll()
	// - select * from member_entity;
	// 2. findById(PK값)
	// - select * from member_entity where 컬럼명=PK값;
	// 3. save(매개변수 or entity)
	// - insert into member_entity values(매개변수 or entity)
	// 4. deleteById(PK값)
	// - delete from member_entity where 컬럼명=PK값;
	
	// 사용자 정의 메소드
	// select * from member_entity where email=? and pw=?;
	// find + (테이블명) + By + 컬럼명 + And(Or) + 컬럼명
	public MemberEntity findByEmailAndPw(String email, String pw);
	
	// 컬럼 Email이 admin인것 빼고 다 조회하기
	// select * from member_entity where email != 'admin';
	public List<MemberEntity> findByEmailNot(String email);
	
	
	// select * from member_entity where email='admin1';
	public MemberEntity findByEmail(String email);
	
	
	
}
